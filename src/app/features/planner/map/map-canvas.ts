import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CatalogItem, findItem, variantsOf } from '../../../core/data/catalog';
import {
  PlacementFailure,
  blockedTiles,
  checkObject,
  lineCells,
  objectAtVisual,
  outlineCells,
  outlinePositions,
  rowCells,
  rowPositions,
  TileRect,
  objectPositions,
  erase,
  paintMisfit,
  paintTiles,
  placeEach,
  placeObjects,
  rectFromCorners,
} from '../../../core/plan/placement';
import { coverageLayout, usesCoverageLayout } from '../../../core/plan/coverage-layout';
import { Patch, cellKey } from '../../../core/plan/plan-document';
import { RestrictionMap } from '../../../core/plan/restriction-map';
import { NO_SELECTION, PlannerStore, Tool } from '../../../core/planner-store';
import { wheelZoomFactor } from './camera';
import { describeGroup } from '../selection-bar';
import { MapRenderer, Preview } from './map-renderer';

/** Screen pixels a pointer may wander before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Pointer samples, in milliseconds, used to measure a flick's speed. */
const FLICK_WINDOW = 80;
/** How long after a right-button release its context menu event is ignored (Windows sends it then). */
const CONTEXT_MENU_GRACE = 500;
/** How long a finger must rest on the map to open the quick search, in milliseconds. */
const LONG_PRESS = 500;
/** How far above a finger, in pixels, what a drag will do is shown, so the finger doesn't cover it. */
const TOUCH_LABEL_LIFT = 60;

type Gesture = (
  | { kind: 'pan'; lastX: number; lastY: number; samples: { t: number; x: number; y: number }[] }
  /** Painting, erasing, box-selecting, or laying out sprinklers over a tile rectangle (or around its edge). */
  | {
      kind: 'rect';
      startX: number;
      startY: number;
      pattern?: 'outline' | 'rows';
      keyboard?: boolean;
    }
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
      aria-label="Farm map. The arrow keys move the map under a cursor in the middle, and Enter places, selects or erases there with the current tool. Plus and minus zoom."
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
      (keydown)="onKeydown($event)"
      (blur)="onBlur()"
    ></div>
    <p class="visually-hidden" aria-live="polite">{{ cursorStatus() }}</p>
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
        Move: drag empty ground (Select), right-drag or Space + drag. Zoom: scroll or pinch. All
        shortcuts: ?
      </p>
      @if (!pinched()) {
        <p class="hint touch-hint">Move and zoom: two fingers. Find an item: press and hold.</p>
      }
    </div>
    @if (dragLabel(); as label) {
      <div
        class="drag-label"
        aria-hidden="true"
        [style.left.px]="label.x + 16"
        [style.top.px]="label.y + 16"
      >
        {{ label.text }}
      </div>
    }
    @if (error(); as message) {
      <div class="loading" role="alert">{{ message }}</div>
    } @else if (loading()) {
      <div class="loading" role="status">Loading map…</div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      background: #1b1410;
    }
    .host {
      position: absolute;
      inset: 0;
      outline: none;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
    .host:focus-visible {
      box-shadow: inset 0 0 0 3px #fbbf24;
    }
    .bar {
      position: absolute;
      left: 8px;
      right: 8px;
      bottom: 8px;
      display: flex;
      align-items: flex-end;
      gap: 8px;
      pointer-events: none;
    }
    .coords,
    .hint,
    .loading {
      padding: 2px 8px;
      border-radius: 4px;
      background: rgb(0 0 0 / 0.65);
      color: #fff;
      font-size: 12px;
      line-height: 1.6;
    }
    .coords {
      flex: none;
      font-family: ui-monospace, monospace;
      white-space: nowrap;
    }
    .hint {
      margin: 0 0 0 auto;
    }
    .loading {
      position: absolute;
      pointer-events: none;
    }
    .drag-label {
      position: absolute;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgb(0 0 0 / 0.75);
      color: #fff;
      font-size: 12px;
      line-height: 1.6;
      white-space: nowrap;
      pointer-events: none;
    }
    @media (max-width: 640px) {
      .hint {
        display: none;
      }
    }
    .loading {
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: 14px;
    }
    .touch-hint {
      display: none;
    }
    /* Touchscreens move with two fingers rather than the mouse and keys. */
    @media (hover: none) and (pointer: coarse) {
      .hint {
        display: none;
      }
      .touch-hint {
        display: block;
      }
    }
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
  /** The pending long press of a single finger, which opens the quick search. */
  private longPress: ReturnType<typeof setTimeout> | undefined;
  /** The restriction map the overlay was last drawn from. */
  private overlaidRestrictions: RestrictionMap | null = null;

  protected readonly spaceHeld = signal(false);
  protected readonly hover = signal<{ x: number; y: number } | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** What a drag in progress will do ("Parsnip × 40 · 8 × 5"), shown by the pointer. */
  protected readonly dragLabel = signal<{ text: string; x: number; y: number } | null>(null);
  /** Whether the hovered tile is the keyboard's cursor (kept in the middle of the view) rather than the pointer's. */
  private readonly keyboardCursor = signal(false);
  /** What's at the keyboard cursor, for screen readers. */
  protected readonly cursorStatus = signal('');
  /** The pointer's last position over the map, in pixels from its top-left. */
  private pointer = { x: 0, y: 0 };
  /** Whether that pointer is a finger, which hides what's under it. */
  private touchPointer = false;
  /** Whether two fingers have moved the map yet, after which the hint saying how is gone. */
  protected readonly pinched = signal(false);
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
    return [obj && findItem(obj.itemId)?.name, ground && findItem(ground)?.name]
      .filter(Boolean)
      .join(' on ');
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
        this.error.set(
          'The map could not start. Your browser may not support WebGL; try enabling hardware acceleration.',
        );
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
        if (
          gesture &&
          gesture.kind !== 'pan' &&
          gesture.kind !== 'pinch' &&
          (gesture.tool !== tool || gesture.itemId !== itemId)
        ) {
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
   * Moves the map by whole tiles under a cursor kept in the middle of the view, which Enter acts
   * on. The cursor starts on the middle tile. With `stretch`, it stretches a rectangle from where
   * the cursor was, for Enter to fill, outline, erase or select like a dragged one.
   */
  moveCursor(dx: number, dy: number, stretch = false): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const from = (this.keyboardCursor() && this.hover()) || renderer.centreTile();
    const { width, height } = this.store.layout();
    const to = {
      x: Math.min(Math.max(from.x + dx, 0), width - 1),
      y: Math.min(Math.max(from.y + dy, 0), height - 1),
    };
    const keyboardRect = this.gesture?.kind === 'rect' && this.gesture.keyboard;
    if (stretch && !keyboardRect) {
      const shape = this.store.options().brushShape;
      const pattern =
        this.store.tool() === 'eraser'
          ? shape === 'outline'
            ? 'outline'
            : undefined
          : shape === 'outline' || shape === 'rows'
            ? shape
            : undefined;
      this.gesture = {
        ...this.context(),
        kind: 'rect',
        startX: from.x,
        startY: from.y,
        pattern,
        keyboard: true,
        button: 0,
        downX: 0,
        downY: 0,
        moved: true,
      };
    } else if (!stretch && keyboardRect) {
      this.gesture = null;
    }
    this.keyboardCursor.set(true);
    renderer.centreOn(to.x, to.y);
    this.showCursorAt(to);
  }

  private showCursorAt(tile: { x: number; y: number }): void {
    this.hover.set(tile);
    const hovered = objectAtVisual(this.store.doc, tile.x, tile.y);
    this.renderer?.setHovered(hovered?.uid ?? null);
    this.updatePreview();
    this.cursorStatus.set(`${tile.x}, ${tile.y}: ${this.hoverLabel() || 'empty'}`);
  }

  /** Enter does what a click would at the keyboard cursor (Shift + Enter: what a Shift + click would). */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const tile = this.hover();
    if (!this.keyboardCursor() || !tile) {
      this.moveCursor(0, 0);
      return;
    }
    const store = this.store;
    const tool = store.tool();
    const gesture = this.gesture;
    if (gesture?.kind === 'rect' && gesture.keyboard) {
      this.gesture = null;
      this.finishRect(gesture, tile);
    } else if (tool === 'select') {
      const hit = objectAtVisual(store.doc, tile.x, tile.y);
      if (hit && event.shiftKey) store.toggleSelected(hit.uid);
      else store.selection.set(hit ? { objects: [hit.uid], tiles: [] } : NO_SELECTION);
    } else if (tool === 'eraser') {
      store.erase({ x: tile.x, y: tile.y, width: 1, height: 1 });
    } else if (store.pasting()) {
      const at = this.pasteOrigin(tile);
      const failure = at ? store.pasteAt(at.x, at.y) : null;
      if (failure) this.blocked.emit(failure);
    } else {
      const item = store.activeItem();
      if (!item) return;
      const centred = item.kind === 'object' && !usesCoverageLayout(item);
      const at = centred ? objectOrigin(item, tile.x, tile.y) : tile;
      this.explainBlockedClick(item, at.x, at.y);
      store.paint({ ...at, width: centred ? item.width : 1, height: centred ? item.height : 1 });
    }
    this.showCursorAt(tile);
  }

  /** Applies a rectangle gesture ending at a tile. A click (not a drag) acts on the tile it started on. */
  private finishRect(
    gesture: Extract<Gesture, { kind: 'rect' }>,
    tile: { x: number; y: number },
  ): void {
    const end = gesture.moved ? tile : { x: gesture.startX, y: gesture.startY };
    const rect = rectFromCorners(gesture.startX, gesture.startY, end.x, end.y);
    const item = this.store.activeItem();
    if (gesture.pattern && gesture.moved) {
      if (this.store.tool() === 'eraser') this.store.erase(outlineCells(rect));
      else if (item) this.store.paintStroke(patternPositions(gesture.pattern, item, rect));
      return;
    }
    switch (this.store.tool()) {
      case 'eraser':
        this.store.erase(rect);
        break;
      case 'select':
        this.store.selectArea(rect);
        break;
      case 'brush': {
        if (item && !gesture.moved) this.explainBlockedClick(item, rect.x, rect.y);
        const single = item?.kind === 'object' && !usesCoverageLayout(item) && !gesture.moved;
        this.store.paint(
          single
            ? { ...objectOrigin(item, rect.x, rect.y), width: item.width, height: item.height }
            : rect,
        );
        break;
      }
    }
  }

  /** Whether the arrow keys are moving the keyboard cursor. */
  get cursorActive(): boolean {
    return this.keyboardCursor();
  }

  protected onBlur(): void {
    if (!this.keyboardCursor()) return;
    this.keyboardCursor.set(false);
    this.hover.set(null);
    this.renderer?.setHovered(null);
    this.updatePreview();
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
    void renderer.setSeason(options.season);
  }

  // --- Pointer input -------------------------------------------------------

  protected onPointerDown(event: PointerEvent): void {
    const renderer = this.renderer;
    if (!renderer) return;
    this.hostRef().nativeElement.focus();
    renderer.stopMotion();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    this.cancelLongPress();
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // A second finger turns whatever the first one started into a pinch.
      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }
      if (this.touches.size > 2) return;
      // A finger held still opens the quick search there, as a right click does.
      const at = { x: event.clientX, y: event.clientY };
      this.longPress = setTimeout(() => {
        this.longPress = undefined;
        if (!this.gesture || this.gesture.moved) return;
        this.gesture = null;
        this.updatePreview();
        this.quickSearch.emit(at);
      }, LONG_PRESS);
    }

    const base = {
      ...this.context(),
      button: event.button,
      downX: event.clientX,
      downY: event.clientY,
      moved: false,
    };
    const pan: Gesture = {
      ...base,
      kind: 'pan',
      lastX: event.clientX,
      lastY: event.clientY,
      samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }],
    };
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
        if (!selection.objects.includes(hit.uid))
          this.store.selection.set({ objects: [hit.uid], tiles: [] });
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
    } else if (
      this.store.options().brushShape === 'outline' ||
      (this.store.options().brushShape === 'rows' && tool === 'brush')
    ) {
      const pattern = this.store.options().brushShape === 'outline' ? 'outline' : 'rows';
      this.gesture = { ...base, kind: 'rect', startX: tile.x, startY: tile.y, pattern };
    } else if (this.store.options().brushShape === 'freehand') {
      this.gesture = {
        ...base,
        kind: 'stroke',
        cells: [[tile.x, tile.y]],
        seen: new Set([cellKey(tile.x, tile.y)]),
        lastX: tile.x,
        lastY: tile.y,
      };
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
    if (this.keyboardCursor()) {
      this.keyboardCursor.set(false);
      // The pointer takes over from a rectangle stretched with the keyboard.
      if (this.gesture?.kind === 'rect' && this.gesture.keyboard) this.gesture = null;
    }
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const gesture = this.gesture;
    if (
      gesture &&
      !gesture.moved &&
      Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY) > DRAG_THRESHOLD
    ) {
      gesture.moved = true;
      this.cancelLongPress();
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
      while (gesture.samples.length > 2 && event.timeStamp - gesture.samples[0].t > FLICK_WINDOW)
        gesture.samples.shift();
      return;
    }
    const tile = renderer.toTile(event.clientX, event.clientY);
    const bounds = this.hostRef().nativeElement.getBoundingClientRect();
    this.pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    this.touchPointer = event.pointerType === 'touch';
    if (gesture?.kind === 'stroke') extendStroke(gesture, tile);
    const previous = this.hover();
    if (previous?.x === tile.x && previous.y === tile.y && gesture?.moved !== true) return;
    this.hover.set(tile);
    const hovered = objectAtVisual(this.store.doc, tile.x, tile.y);
    this.overMovable.set(
      hovered !== null || this.store.selection().tiles.includes(cellKey(tile.x, tile.y)),
    );
    renderer.setHovered(hovered?.uid ?? null);
    this.updatePreview();
  }

  private cancelLongPress(): void {
    clearTimeout(this.longPress);
    this.longPress = undefined;
  }

  protected onPointerUp(event: PointerEvent): void {
    this.cancelLongPress();
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
      this.finishRect(gesture, tile);
    }
    this.updatePreview();
  }

  protected onPointerCancel(event: PointerEvent): void {
    this.cancelLongPress();
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
    const fromRightButton =
      this.gesture?.button === 2 || event.timeStamp - this.lastRightRelease < CONTEXT_MENU_GRACE;
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
    this.pinched.set(true);
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
  private placementRect(
    gesture: Extract<Gesture, { kind: 'place' }>,
    item: CatalogItem,
    end: { x: number; y: number } | null,
  ) {
    const to = end ? objectOrigin(item, end.x, end.y) : { x: gesture.originX, y: gesture.originY };
    // Whole copies only, repeating from the first one toward the pointer. Buildings with a door
    // repeat downward with a row free in front of it (see objectPositions).
    const span = (from: number, toward: number, size: number, step: number) => {
      const count = Math.floor(Math.abs(toward - from) / step) + 1;
      return {
        start: toward < from ? from - (count - 1) * step : from,
        length: (count - 1) * step + size,
      };
    };
    const across = span(gesture.originX, to.x, item.width, item.width);
    const down = span(
      gesture.originY,
      to.y,
      item.height,
      item.height + (item.building?.door ? 1 : 0),
    );
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
      this.dragLabel.set(null);
      return;
    }
    const store = this.store;
    const options = store.options();
    const preview: Preview = {};
    let label: string | null = null;

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
      const rect = item && this.placementRect(gesture, item, gesture.moved ? tile : null);
      if (item && rect) {
        this.previewObjects(preview, item, rect);
        if (gesture.moved)
          label = `${item.name} × ${placeObjects(store.doc, store.restrictions, item, rect, options).objects.length}`;
      }
    } else if (gesture?.kind === 'rect') {
      const end = gesture.moved ? tile : { x: gesture.startX, y: gesture.startY };
      const rect = rectFromCorners(gesture.startX, gesture.startY, end.x, end.y);
      const tool = store.tool();
      const item = store.activeItem();
      preview.rect = {
        ...rect,
        style: tool === 'eraser' ? 'erase' : tool === 'select' ? 'select' : 'brush',
      };
      const size = `${rect.width} × ${rect.height}`;
      if (gesture.pattern && gesture.moved) {
        preview.rect = undefined;
        if (tool === 'eraser') {
          preview.erased = outlineCells(rect);
          label = `Erase ${describeErased(erase(store.doc, preview.erased))} · ${size}`;
        } else if (item?.kind === 'tile') {
          const cells = patternPositions(gesture.pattern, item, rect).map(
            ({ x, y }): [number, number] => [x, y],
          );
          preview.blocked = blockedTiles(store.doc, store.restrictions, item, cells, options);
          const blocked = new Set(preview.blocked.map(([x, y]) => cellKey(x, y)));
          preview.tiles = cells
            .filter(([x, y]) => !blocked.has(cellKey(x, y)))
            .map(([x, y]) => ({ item, x, y }));
          label = `${item.name} × ${paintTiles(store.doc, store.restrictions, item, cells, options).tiles.length} · ${size}`;
        } else if (item) {
          preview.ghosts = placeEach(
            store.doc,
            store.restrictions,
            item,
            patternPositions(gesture.pattern, item, rect),
            options,
          ).objects.map((change) => ({ item, ...change.after! }));
          label = `${item.name} × ${preview.ghosts.length} · ${size}`;
        }
      } else if (tool === 'brush' && item?.kind === 'tile') {
        preview.blocked = blockedTiles(store.doc, store.restrictions, item, rect, options);
        label = `${item.name} × ${paintTiles(store.doc, store.restrictions, item, rect, options).tiles.length} · ${size}`;
      } else if (
        tool === 'brush' &&
        item &&
        usesCoverageLayout(item) &&
        (rect.width > 1 || rect.height > 1)
      ) {
        // Show where the sprinklers or scarecrows will go and what they'll cover.
        preview.ghosts = coverageLayout(store.doc, store.restrictions, item, rect, options).map(
          (at) => ({ item, ...at }),
        );
        label = `${item.name} × ${preview.ghosts.length} · ${size}`;
      } else if (tool === 'eraser') {
        label = `Erase ${describeErased(erase(store.doc, rect))} · ${size}`;
      } else {
        label = size;
      }
      if (!gesture.moved) label = null;
    } else if (gesture?.kind === 'stroke') {
      const item = store.activeItem();
      if (gesture.tool === 'eraser') {
        preview.erased = gesture.cells;
        label = `Erase ${describeErased(erase(store.doc, gesture.cells))}`;
      } else if (item?.kind === 'tile') {
        preview.blocked = blockedTiles(store.doc, store.restrictions, item, gesture.cells, options);
        const blocked = new Set(preview.blocked.map(([x, y]) => cellKey(x, y)));
        preview.tiles = gesture.cells
          .filter(([x, y]) => !blocked.has(cellKey(x, y)))
          .map(([x, y]) => ({ item, x, y }));
        label = `${item.name} × ${paintTiles(store.doc, store.restrictions, item, gesture.cells, options).tiles.length}`;
      } else if (item) {
        preview.ghosts = placeEach(
          store.doc,
          store.restrictions,
          item,
          this.strokePoints(gesture),
          options,
        ).objects.map((change) => ({ item, ...change.after! }));
        label = `${item.name} × ${preview.ghosts.length}`;
      }
      if (!gesture.moved) label = null;
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
    if (this.keyboardCursor()) preview.cursor = tile;
    renderer.setPreview(preview);
    // By the pointer (above a finger), or by the keyboard cursor in the middle of the map.
    const host = this.hostRef().nativeElement;
    const pointer = this.touchPointer
      ? { x: this.pointer.x, y: this.pointer.y - TOUCH_LABEL_LIFT }
      : this.pointer;
    const at = this.keyboardCursor()
      ? { x: host.clientWidth / 2, y: host.clientHeight / 2 }
      : pointer;
    this.dragLabel.set(label ? { text: label, ...at } : null);
  }

  /** When a click can't put the brush's item down, says why. */
  private explainBlockedClick(item: CatalogItem, x: number, y: number): void {
    const { doc, restrictions } = this.store;
    const options = this.store.options();
    const reason =
      item.kind === 'tile'
        ? paintMisfit(doc, restrictions, item, x, y, options)
        : checkObject(doc, restrictions, item, x, y, options).reason;
    if (reason) this.blocked.emit({ itemId: item.id, reason });
  }

  /** Where a freehand stroke puts things: its cells for tiles, or an object centred on each. */
  private strokePoints(gesture: Extract<Gesture, { kind: 'stroke' }>): { x: number; y: number }[] {
    const item = findItem(gesture.itemId ?? '');
    return gesture.cells.map(([x, y]) =>
      item?.kind === 'object' ? objectOrigin(item, x, y) : { x, y },
    );
  }

  /** Where the clipboard's top-left goes to centre it on a tile. */
  private pasteOrigin(tile: { x: number; y: number }): { x: number; y: number } | null {
    const clipboard = this.store.clipboard();
    if (!clipboard) return null;
    const width = Math.max(
      ...clipboard.tiles.map((t) => t.x + 1),
      ...clipboard.objects.map((o) => o.x + (findItem(o.itemId)?.width ?? 1)),
    );
    const height = Math.max(
      ...clipboard.tiles.map((t) => t.y + 1),
      ...clipboard.objects.map((o) => o.y + (findItem(o.itemId)?.height ?? 1)),
    );
    return { x: tile.x - Math.floor((width - 1) / 2), y: tile.y - Math.floor((height - 1) / 2) };
  }

  /** Ghosts for every copy a placement would make, with the tiles that block any of them. */
  private previewObjects(
    preview: Preview,
    item: CatalogItem,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
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

/** Where an Outline or Rows drag puts an item's copies (cells, for ground tiles). */
function patternPositions(
  pattern: 'outline' | 'rows',
  item: CatalogItem,
  rect: TileRect,
): { x: number; y: number }[] {
  if (item.kind === 'tile')
    return (pattern === 'outline' ? outlineCells(rect) : rowCells(rect)).map(([x, y]) => ({
      x,
      y,
    }));
  return pattern === 'outline' ? outlinePositions(item, rect) : rowPositions(item, rect);
}

/** "3 objects and 12 tiles": what an erase would remove. */
function describeErased(patch: Patch): string {
  return describeGroup({
    objects: patch.objects.flatMap((change) => change.before ?? []),
    tiles: patch.tiles.flatMap((t) => (t.before ? [{ x: t.x, y: t.y, itemId: t.before }] : [])),
  });
}

/** Adds the cells from a stroke's last tile to the pointer's, so fast strokes leave no gaps. */
function extendStroke(
  gesture: Extract<Gesture, { kind: 'stroke' }>,
  tile: { x: number; y: number },
): void {
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
