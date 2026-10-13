import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, output, signal, untracked, viewChild } from '@angular/core';
import { CatalogItem, findItem, variantsOf } from '../../../core/data/catalog';
import {
  PlacementFailure,
  blockedTiles,
  checkObject,
  lineCells,
  objectAtVisual,
  objectPositions,
  paintMisfit,
  placeEach,
  rectFromCorners,
} from '../../../core/plan/placement';
import { coverageLayout, usesCoverageLayout } from '../../../core/plan/coverage-layout';
import { cellKey } from '../../../core/plan/plan-document';
import { RestrictionMap } from '../../../core/plan/restriction-map';
import { NO_SELECTION, PlannerStore, Tool } from '../../../core/planner-store';
import { wheelZoomFactor } from './camera';
import { MapRenderer, Preview } from './map-renderer';

/** Screen pixels a pointer may wander before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Pointer samples, in milliseconds, used to measure a flick's speed. */
const FLICK_WINDOW = 80;
/** How long after a right-button release its context menu event is ignored (Windows sends it then). */
const CONTEXT_MENU_GRACE = 500;

type Gesture = (
  | { kind: 'pan'; lastX: number; lastY: number; samples: { t: number; x: number; y: number }[] }
  /** Painting, erasing, box-selecting, or laying out sprinklers over a tile rectangle. */
  | { kind: 'rect'; startX: number; startY: number }
  /** Placing copies of an object, anchored where its ghost was when the press started. */
  | { kind: 'place'; originX: number; originY: number }
  /** Dragging the selection. */
  | { kind: 'move'; startX: number; startY: number }
  /** Pasting the clipboard where the pointer is let go. */
  | { kind: 'paste' }
  /** Painting, placing or erasing along the pointer's path (the freehand brush). */
  | { kind: 'stroke'; cells: [number, number][]; seen: Set<string>; lastX: number; lastY: number }
  | { kind: 'pinch'; distance: number; midX: number; midY: number }
) & {
  /** Tool and item the gesture started with; switching either cancels it. */
  tool: Tool;
  itemId: string | null;
  button: number;
  downX: number;
  downY: number;
  /** Whether the pointer has moved past the drag threshold. */
  moved: boolean;
};

/**
 * Hosts the PixiJS canvas and turns pointer input into planner edits and map movement.
 *
 * Moving around works like an online map: drag empty ground with the Select tool (or right-drag,
 * or Space + drag, with any tool) to pan, flick to glide, scroll or pinch to zoom where the pointer
 * is, and double-click to zoom in. Touchscreens pinch and pan with two fingers.
 */
@Component({
  selector: 'app-map-canvas',
  host: {
    class: 'map-canvas',
    '(document:keydown.space)': 'spaceHeld.set(true)',
    '(document:keyup.space)': 'spaceHeld.set(false)',
  },
  template: `
    <div
      #host
      class="host"
      role="application"
      aria-label="Farm map. Use the toolbar or keyboard shortcuts to edit, the arrow keys to move around and plus or minus to zoom."
      aria-describedby="map-navigation-hint"
      tabindex="0"
      [style.cursor]="cursor()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerCancel($event)"
      (pointerleave)="onPointerLeave()"
      (wheel)="onWheel($event)"
      (dblclick)="onDoubleClick($event)"
      (contextmenu)="onContextMenu($event)"
    ></div>
    <div class="bar">
      @if (hover(); as tile) {
        <span class="coords" aria-hidden="true">
          {{ tile.x }}, {{ tile.y }}
          @if (hoverLabel(); as label) {
            · {{ label }}
          }
        </span>
      }
      <p id="map-navigation-hint" class="hint">
        Move: drag empty ground (Select), right-drag or Space + drag. Zoom: scroll or pinch. All shortcuts: ?
      </p>
    </div>
    @if (error(); as message) {
      <div class="loading" role="alert">{{ message }}</div>
    } @else if (loading()) {
      <div class="loading" role="status">Loading map…</div>
    }
  `,
  styles: `
    :host { position: relative; display: block; overflow: hidden; background: #1b1410; }
    .host { position: absolute; inset: 0; outline: none; touch-action: none; }
    .host:focus-visible { box-shadow: inset 0 0 0 3px #fbbf24; }
    .bar {
      position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; align-items: flex-end; gap: 8px;
      pointer-events: none;
    }
    .coords, .hint, .loading { padding: 2px 8px; border-radius: 4px; background: rgb(0 0 0 / 0.65); color: #fff; font-size: 12px; line-height: 1.6; }
    .coords { flex: none; font-family: ui-monospace, monospace; white-space: nowrap; }
    .hint { margin: 0 0 0 auto; }
    .loading { position: absolute; pointer-events: none; }
    @media (max-width: 640px) { .hint { display: none; } }
    .loading { left: 50%; top: 50%; transform: translate(-50%, -50%); font-size: 14px; }
  `,
})
export class MapCanvas {
  private readonly store = inject(PlannerStore);
  private readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private renderer: MapRenderer | null = null;
  private gesture: Gesture | null = null;
  /** Touch points currently down, for pinching. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private lastRightRelease = -Infinity;
  /** The restriction map the overlay was last drawn from. */
  private overlaidRestrictions: RestrictionMap | null = null;

  protected readonly spaceHeld = signal(false);
  protected readonly hover = signal<{ x: number; y: number } | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly panning = signal(false);
  /** Whether the pointer is over something the Select tool can drag: an object or a selected tile. */
  private readonly overMovable = signal(false);

  /** Shows what a drag would do: pan the map, move an object, or draw. */
  protected readonly cursor = computed(() => {
    if (this.panning()) return 'grabbing';
    if (this.spaceHeld()) return 'grab';
    if (this.store.tool() !== 'select') return 'crosshair';
    return this.overMovable() ? 'move' : 'grab';
  });

  /** The names of what's under the pointer: an object, and the ground tile under it. */
  protected readonly hoverLabel = computed(() => {
    const tile = this.hover();
    this.store.revision();
    if (!tile) return '';
    const obj = objectAtVisual(this.store.doc, tile.x, tile.y);
    const ground = this.store.doc.tileAt(tile.x, tile.y);
    return [obj && findItem(obj.itemId)?.name, ground && findItem(ground)?.name].filter(Boolean).join(' on ');
  });

  /** Right click: open the quick item search at the given screen position. */
  readonly quickSearch = output<{ x: number; y: number }>();
  /** Select-tool click (without dragging) on an object that has variants. */
  readonly variantRequest = output<{ uid: number; x: number; y: number }>();
  /** Alt + click (or I) made the item under the pointer the brush. */
  readonly picked = output<CatalogItem>();
  /** A click or drag couldn't put something where it was aimed, and why. */
  readonly blocked = output<PlacementFailure>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(async () => {
      const renderer = new MapRenderer();
      destroyRef.onDestroy(() => renderer.destroy());
      try {
        await renderer.init(this.hostRef().nativeElement);
      } catch (error) {
        console.error('Map failed to start', error);
        this.error.set('The map could not start. Your browser may not support WebGL; try enabling hardware acceleration.');
        return;
      }
      this.renderer = renderer;
      const unlisten = this.store.listen({
        patched: (patch) => {
          renderer.applyPatch(patch);
          // Buildings change the ground around them, and the greenhouse's first move clears the grass.
          if (!this.overlaidRestrictions?.equals(this.store.restrictions)) this.syncOptions();
        },
        reset: () => void this.syncLayout(),
      });
      destroyRef.onDestroy(unlisten);
      await this.syncLayout();
      this.loading.set(false);
      this.syncOptions();
    });

    effect(() => {
      this.store.options();
      this.syncOptions();
    });
    effect(() => {
      const selection = this.store.selection();
      this.renderer?.setSelection(selection);
    });
    effect(() => {
      // Switching tools or items cancels an edit started with the old ones. Effects run after
      // change detection, so a gesture may already have started with the new tool by now.
      const tool = this.store.tool();
      const itemId = this.store.activeItem()?.id ?? null;
      this.store.pasting();
      this.store.clipboard();
      untracked(() => {
        const gesture = this.gesture;
        if (gesture && gesture.kind !== 'pan' && gesture.kind !== 'pinch' && (gesture.tool !== tool || gesture.itemId !== itemId)) {
          this.gesture = null;
        }
        this.updatePreview();
      });
    });
  }

  zoomIn(): void {
    this.renderer?.zoomAt(1.5);
  }

  zoomOut(): void {
    this.renderer?.zoomAt(1 / 1.5);
  }

  fit(): void {
    this.renderer?.fitToView();
  }

  panBy(dx: number, dy: number): void {
    this.renderer?.panBy(dx, dy);
  }

  /**
   * Makes the item under the pointer (an object, or else the ground tile) the brush, like an
   * eyedropper. Returns it, or null when there's nothing there.
   */
  pickHovered(): CatalogItem | null {
    const tile = this.hover();
    return tile ? this.pickAt(tile) : null;
  }

  private pickAt(tile: { x: number; y: number }): CatalogItem | null {
    const obj = objectAtVisual(this.store.doc, tile.x, tile.y);
    const id = obj?.itemId ?? this.store.doc.tileAt(tile.x, tile.y);
    const item = id ? findItem(id) : undefined;
    if (!item) return null;
    this.store.selectItem(item);
    this.picked.emit(item);
    return item;
  }

  /** Abandons an in-progress edit gesture. Returns true if there was one. */
  cancel(): boolean {
    if (!this.gesture || this.gesture.kind === 'pan' || this.gesture.kind === 'pinch') return false;
    this.gesture = null;
    this.updatePreview();
    return true;
  }

  exportPng(): Promise<Blob> | null {
    return this.renderer?.exportPng() ?? null;
  }

  private async syncLayout(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    await renderer.setLayout(this.store.layout(), this.store.doc);
    this.syncOptions();
  }

  private syncOptions(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const options = this.store.options();
    renderer.setGridVisible(options.showGrid);
    this.overlaidRestrictions = this.store.restrictions;
    renderer.setRestrictionOverlay(options.restrictionOverlay, this.overlaidRestrictions);
    renderer.setAlwaysShowRanges(options.alwaysShowRanges);
  }

  // --- Pointer input -------------------------------------------------------

  protected onPointerDown(event: PointerEvent): void {
    const renderer = this.renderer;
    if (!renderer) return;
    this.hostRef().nativeElement.focus();
    renderer.stopMotion();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // A second finger turns whatever the first one started into a pinch.
      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }
      if (this.touches.size > 2) return;
    }

    const base = { ...this.context(), button: event.button, downX: event.clientX, downY: event.clientY, moved: false };
    const pan: Gesture = { ...base, kind: 'pan', lastX: event.clientX, lastY: event.clientY, samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }] };
    // Middle and right buttons, and Space + drag, pan with any tool. A right click opens the quick search.
    if (event.button === 1 || event.button === 2 || (event.button === 0 && this.spaceHeld())) {
      event.preventDefault();
      this.gesture = pan;
      return;
    }
    if (event.button !== 0) return;

    const tile = renderer.toTile(event.clientX, event.clientY);
    const tool = this.store.tool();
    const item = this.store.activeItem();
    if (event.altKey) {
      // Alt + click picks up the item there as the brush, like an eyedropper.
      this.gesture = null;
      this.pickAt(tile);
    } else if (tool === 'select') {
      const hit = objectAtVisual(this.store.doc, tile.x, tile.y);
      const selection = this.store.selection();
      if (hit && event.shiftKey) {
        // Shift + click adds an object to the selection or takes it out.
        this.store.toggleSelected(hit.uid);
        this.gesture = null;
      } else if (hit) {
        if (!selection.objects.includes(hit.uid)) this.store.selection.set({ objects: [hit.uid], tiles: [] });
        this.gesture = { ...base, kind: 'move', startX: tile.x, startY: tile.y };
      } else if (selection.tiles.includes(cellKey(tile.x, tile.y))) {
        this.gesture = { ...base, kind: 'move', startX: tile.x, startY: tile.y };
      } else if (event.shiftKey) {
        this.gesture = { ...base, kind: 'rect', startX: tile.x, startY: tile.y };
      } else {
        // Empty ground: drag the map, like an online map.
        this.gesture = pan;
      }
    } else if (tool === 'brush' && this.store.pasting()) {
      this.gesture = { ...base, kind: 'paste' };
    } else if (this.store.options().brushShape === 'freehand') {
      this.gesture = { ...base, kind: 'stroke', cells: [[tile.x, tile.y]], seen: new Set([cellKey(tile.x, tile.y)]), lastX: tile.x, lastY: tile.y };
    } else if (tool === 'brush' && item?.kind === 'object' && !usesCoverageLayout(item)) {
      const origin = objectOrigin(item, tile.x, tile.y);
      this.gesture = { ...base, kind: 'place', originX: origin.x, originY: origin.y };
    } else {
      this.gesture = { ...base, kind: 'rect', startX: tile.x, startY: tile.y };
    }
    this.updatePreview();
  }

  protected onPointerMove(event: PointerEvent): void {
    const renderer = this.renderer;
    if (!renderer) return;
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const gesture = this.gesture;
    if (gesture && !gesture.moved && Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY) > DRAG_THRESHOLD) {
      gesture.moved = true;
    }
    if (gesture?.kind === 'pinch') {
      this.continuePinch(gesture);
      return;
    }
    if (gesture?.kind === 'pan') {
      if (!gesture.moved) return;
      this.panning.set(true);
      renderer.panBy(event.clientX - gesture.lastX, event.clientY - gesture.lastY);
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      gesture.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
      while (gesture.samples.length > 2 && event.timeStamp - gesture.samples[0].t > FLICK_WINDOW) gesture.samples.shift();
      return;
    }
    const tile = renderer.toTile(event.clientX, event.clientY);
    if (gesture?.kind === 'stroke') extendStroke(gesture, tile);
    const previous = this.hover();
    if (previous?.x === tile.x && previous.y === tile.y && gesture?.moved !== true) return;
    this.hover.set(tile);
    const hovered = objectAtVisual(this.store.doc, tile.x, tile.y);
    this.overMovable.set(hovered !== null || this.store.selection().tiles.includes(cellKey(tile.x, tile.y)));
    renderer.setHovered(hovered?.uid ?? null);
    this.updatePreview();
  }

  protected onPointerUp(event: PointerEvent): void {
    this.touches.delete(event.pointerId);
    const gesture = this.gesture;
    const renderer = this.renderer;
    if (!gesture || !renderer) return;
    // Lifting one finger of a pinch leaves the other one idle until it lifts too.
    if (gesture.kind === 'pinch') {
      if (this.touches.size === 0) this.gesture = null;
      return;
    }
    this.gesture = null;
    if (event.button === 2) this.lastRightRelease = event.timeStamp;

    if (gesture.kind === 'pan') {
      this.panning.set(false);
      if (gesture.moved) {
        this.flick(gesture.samples, event.timeStamp);
      } else if (gesture.button === 2) {
        this.quickSearch.emit({ x: event.clientX, y: event.clientY });
      } else if (gesture.button === 0 && this.store.tool() === 'select' && !this.spaceHeld()) {
        this.store.selection.set(NO_SELECTION);
      }
      this.updatePreview();
      return;
    }

    const tile = renderer.toTile(event.clientX, event.clientY);
    if (gesture.kind === 'move') {
      const dx = tile.x - gesture.startX;
      const dy = tile.y - gesture.startY;
      if (!gesture.moved) {
        // A click selects just what was clicked: an object (offering its variants), or nothing on a selected tile.
        const clicked = objectAtVisual(this.store.doc, gesture.startX, gesture.startY);
        this.store.selection.set(clicked ? { objects: [clicked.uid], tiles: [] } : NO_SELECTION);
        if (clicked && variantsOf(clicked.itemId).length > 1) {
          this.variantRequest.emit({ uid: clicked.uid, x: event.clientX, y: event.clientY });
        }
      } else if (dx !== 0 || dy !== 0) {
        const failure = this.store.moveSelection(dx, dy);
        if (failure) this.blocked.emit(failure);
      }
    } else if (gesture.kind === 'place') {
      const item = findItem(gesture.itemId ?? '');
      if (item && !gesture.moved) this.explainBlockedClick(item, gesture.originX, gesture.originY);
      if (item) this.store.paint(this.placementRect(gesture, item, gesture.moved ? tile : null));
    } else if (gesture.kind === 'paste') {
      const at = this.pasteOrigin(tile);
      const failure = at && this.store.pasting() ? this.store.pasteAt(at.x, at.y) : null;
      if (failure) this.blocked.emit(failure);
    } else if (gesture.kind === 'stroke') {
      extendStroke(gesture, tile);
      if (gesture.tool === 'eraser') this.store.erase(gesture.cells);
      else this.store.paintStroke(this.strokePoints(gesture));
    } else {
      // A click (not a drag) acts on the tile it started on.
      const end = gesture.moved ? tile : { x: gesture.startX, y: gesture.startY };
      const rect = rectFromCorners(gesture.startX, gesture.startY, end.x, end.y);
      switch (this.store.tool()) {
        case 'eraser':
          this.store.erase(rect);
          break;
        case 'select':
          this.store.selectArea(rect);
          break;
        case 'brush': {
          const item = this.store.activeItem();
          if (item && !gesture.moved) this.explainBlockedClick(item, rect.x, rect.y);
          this.store.paint(rect);
          break;
        }
      }
    }
    this.updatePreview();
  }

  protected onPointerCancel(event: PointerEvent): void {
    this.touches.delete(event.pointerId);
    this.gesture = null;
    this.panning.set(false);
    this.updatePreview();
  }

  protected onPointerLeave(): void {
    if (this.gesture) return;
    this.hover.set(null);
    this.overMovable.set(false);
    this.renderer?.setHovered(null);
    this.updatePreview();
  }

  /** Scrolling zooms around the pointer, as on online maps; trackpad pinches arrive as Ctrl + scroll. */
  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.renderer?.zoomAt(wheelZoomFactor(event), event.clientX, event.clientY);
  }

  /** Double-clicking empty ground with the Select tool zooms in there (Shift zooms out). */
  protected onDoubleClick(event: MouseEvent): void {
    const renderer = this.renderer;
    if (!renderer || this.store.tool() !== 'select') return;
    const tile = renderer.toTile(event.clientX, event.clientY);
    if (objectAtVisual(this.store.doc, tile.x, tile.y)) return;
    renderer.zoomAt(event.shiftKey ? 0.5 : 2, event.clientX, event.clientY);
  }

  protected onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    // Right clicks open the quick search on release, so that a right-drag can pan instead. Only
    // the keyboard's context menu key gets here without a right-button press.
    const fromRightButton = this.gesture?.button === 2 || event.timeStamp - this.lastRightRelease < CONTEXT_MENU_GRACE;
    if (fromRightButton) return;
    this.cancel();
    const bounds = this.hostRef().nativeElement.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    this.quickSearch.emit({
      x: keyboard ? bounds.left + bounds.width / 2 : event.clientX,
      y: keyboard ? bounds.top + bounds.height / 2 : event.clientY,
    });
  }

  private context(): { tool: Tool; itemId: string | null } {
    return { tool: this.store.tool(), itemId: this.store.activeItem()?.id ?? null };
  }

  private startPinch(): void {
    const [a, b] = [...this.touches.values()];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    this.gesture = {
      ...this.context(),
      kind: 'pinch',
      button: 0,
      downX: midX,
      downY: midY,
      moved: true,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      midX,
      midY,
    };
    this.panning.set(false);
    this.updatePreview();
  }

  private continuePinch(gesture: Extract<Gesture, { kind: 'pinch' }>): void {
    const renderer = this.renderer;
    const [a, b] = [...this.touches.values()];
    if (!renderer || !a || !b) return;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    renderer.panBy(midX - gesture.midX, midY - gesture.midY);
    if (gesture.distance > 0) renderer.zoomAt(distance / gesture.distance, midX, midY, false);
    gesture.distance = distance;
    gesture.midX = midX;
    gesture.midY = midY;
  }

  /** Lets the map glide on after a quick drag, at the speed it was moving when released. */
  private flick(samples: { t: number; x: number; y: number }[], now: number): void {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t;
    // A pause before letting go means no glide.
    if (dt <= 0 || now - last.t > 50) return;
    this.renderer?.fling((last.x - first.x) / dt, (last.y - first.y) / dt);
  }

  /**
   * Where a place gesture puts objects: one where its ghost was on a click, or copies filling the
   * dragged area, anchored at that first ghost.
   */
  private placementRect(gesture: Extract<Gesture, { kind: 'place' }>, item: CatalogItem, end: { x: number; y: number } | null) {
    const to = end ? objectOrigin(item, end.x, end.y) : { x: gesture.originX, y: gesture.originY };
    // Whole copies only, repeating from the first one toward the pointer.
    const span = (from: number, toward: number, size: number) => {
      const count = Math.floor(Math.abs(toward - from) / size) + 1;
      return { start: toward < from ? from - (count - 1) * size : from, length: count * size };
    };
    const across = span(gesture.originX, to.x, item.width);
    const down = span(gesture.originY, to.y, item.height);
    return { x: across.start, y: down.start, width: across.length, height: down.length };
  }

  /** Draws what the current tool would do at the hovered tile. */
  private updatePreview(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const tile = this.hover();
    const gesture = this.gesture;
    if (!tile || gesture?.kind === 'pan' || gesture?.kind === 'pinch' || this.spaceHeld()) {
      renderer.setPreview(null);
      return;
    }
    const store = this.store;
    const options = store.options();
    const preview: Preview = {};

    if (gesture?.kind === 'move') {
      const dx = tile.x - gesture.startX;
      const dy = tile.y - gesture.startY;
      if (gesture.moved && (dx !== 0 || dy !== 0)) {
        const group = store.selectedGroup();
        preview.ghosts = group.objects.flatMap((obj) => {
          const item = findItem(obj.itemId);
          return item ? [{ item, x: obj.x + dx, y: obj.y + dy }] : [];
        });
        preview.tiles = group.tiles.flatMap((t) => {
          const item = findItem(t.itemId);
          return item ? [{ item, x: t.x + dx, y: t.y + dy }] : [];
        });
        preview.blocked = store.tryMoveSelection(dx, dy).blocked;
      }
    } else if (gesture?.kind === 'place') {
      const item = findItem(gesture.itemId ?? '');
      if (item) this.previewObjects(preview, item, this.placementRect(gesture, item, gesture.moved ? tile : null));
    } else if (gesture?.kind === 'rect') {
      const end = gesture.moved ? tile : { x: gesture.startX, y: gesture.startY };
      const rect = rectFromCorners(gesture.startX, gesture.startY, end.x, end.y);
      const tool = store.tool();
      const item = store.activeItem();
      preview.rect = { ...rect, style: tool === 'eraser' ? 'erase' : tool === 'select' ? 'select' : 'brush' };
      if (tool === 'brush' && item?.kind === 'tile') {
        preview.blocked = blockedTiles(store.doc, store.restrictions, item, rect, options);
      } else if (tool === 'brush' && item && usesCoverageLayout(item) && (rect.width > 1 || rect.height > 1)) {
        // Show where the sprinklers or scarecrows will go and what they'll cover.
        preview.ghosts = coverageLayout(store.doc, store.restrictions, item, rect, options).map((at) => ({ item, ...at }));
      }
    } else if (gesture?.kind === 'stroke') {
      const item = store.activeItem();
      if (gesture.tool === 'eraser') {
        preview.erased = gesture.cells;
      } else if (item?.kind === 'tile') {
        preview.blocked = blockedTiles(store.doc, store.restrictions, item, gesture.cells, options);
        const blocked = new Set(preview.blocked.map(([x, y]) => cellKey(x, y)));
        preview.tiles = gesture.cells.filter(([x, y]) => !blocked.has(cellKey(x, y))).map(([x, y]) => ({ item, x, y }));
      } else if (item) {
        preview.ghosts = placeEach(store.doc, store.restrictions, item, this.strokePoints(gesture), options).objects.map((change) => ({ item, ...change.after! }));
      }
    } else if (store.tool() === 'brush' && store.pasting()) {
      const at = this.pasteOrigin(tile);
      const clipboard = store.clipboard();
      if (at && clipboard) {
        preview.ghosts = clipboard.objects.flatMap((obj) => {
          const item = findItem(obj.itemId);
          return item ? [{ item, x: at.x + obj.x, y: at.y + obj.y }] : [];
        });
        preview.tiles = clipboard.tiles.flatMap((t) => {
          const item = findItem(t.itemId);
          return item ? [{ item, x: at.x + t.x, y: at.y + t.y }] : [];
        });
        preview.blocked = store.tryPaste(at.x, at.y)?.blocked;
      }
    } else if (store.tool() === 'brush') {
      const item = store.activeItem();
      if (item?.kind === 'object') {
        // Sprinklers and scarecrows go where the pointer is; anything bigger centres on it.
        const at = usesCoverageLayout(item) ? tile : objectOrigin(item, tile.x, tile.y);
        this.previewObjects(preview, item, { ...at, width: item.width, height: item.height });
      } else if (item) {
        preview.rect = { x: tile.x, y: tile.y, width: 1, height: 1, style: 'brush' };
        preview.blocked = blockedTiles(store.doc, store.restrictions, item, preview.rect, options);
      }
    } else if (store.tool() === 'eraser') {
      preview.rect = { x: tile.x, y: tile.y, width: 1, height: 1, style: 'erase' };
    }
    renderer.setPreview(preview);
  }

  /** When a click can't put the brush's item down, says why. */
  private explainBlockedClick(item: CatalogItem, x: number, y: number): void {
    const { doc, restrictions } = this.store;
    const options = this.store.options();
    const reason = item.kind === 'tile' ? paintMisfit(doc, restrictions, item, x, y, options) : checkObject(doc, restrictions, item, x, y, options).reason;
    if (reason) this.blocked.emit({ itemId: item.id, reason });
  }

  /** Where a freehand stroke puts things: its cells for tiles, or an object centred on each. */
  private strokePoints(gesture: Extract<Gesture, { kind: 'stroke' }>): { x: number; y: number }[] {
    const item = findItem(gesture.itemId ?? '');
    return gesture.cells.map(([x, y]) => (item?.kind === 'object' ? objectOrigin(item, x, y) : { x, y }));
  }

  /** Where the clipboard's top-left goes to centre it on a tile. */
  private pasteOrigin(tile: { x: number; y: number }): { x: number; y: number } | null {
    const clipboard = this.store.clipboard();
    if (!clipboard) return null;
    const width = Math.max(...clipboard.tiles.map((t) => t.x + 1), ...clipboard.objects.map((o) => o.x + (findItem(o.itemId)?.width ?? 1)));
    const height = Math.max(...clipboard.tiles.map((t) => t.y + 1), ...clipboard.objects.map((o) => o.y + (findItem(o.itemId)?.height ?? 1)));
    return { x: tile.x - Math.floor((width - 1) / 2), y: tile.y - Math.floor((height - 1) / 2) };
  }

  /** Ghosts for every copy a placement would make, with the tiles that block any of them. */
  private previewObjects(preview: Preview, item: CatalogItem, rect: { x: number; y: number; width: number; height: number }): void {
    const { doc, restrictions } = this.store;
    const options = this.store.options();
    preview.ghosts = [];
    preview.blocked = [];
    for (const at of objectPositions(item, rect)) {
      preview.ghosts.push({ item, ...at });
      preview.blocked.push(...checkObject(doc, restrictions, item, at.x, at.y, options).blocked);
    }
  }
}

/** Adds the cells from a stroke's last tile to the pointer's, so fast strokes leave no gaps. */
function extendStroke(gesture: Extract<Gesture, { kind: 'stroke' }>, tile: { x: number; y: number }): void {
  if (tile.x === gesture.lastX && tile.y === gesture.lastY) return;
  for (const [x, y] of lineCells(gesture.lastX, gesture.lastY, tile.x, tile.y)) {
    if (gesture.seen.has(cellKey(x, y))) continue;
    gesture.seen.add(cellKey(x, y));
    gesture.cells.push([x, y]);
  }
  gesture.lastX = tile.x;
  gesture.lastY = tile.y;
}

/** The top-left tile that centres an object's footprint on a tile, as its ghost shows. */
function objectOrigin(item: CatalogItem, x: number, y: number): { x: number; y: number } {
  return { x: x - Math.floor((item.width - 1) / 2), y: y - Math.floor((item.height - 1) / 2) };
}
