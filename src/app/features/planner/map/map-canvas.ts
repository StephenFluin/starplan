import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, output, signal, untracked, viewChild } from '@angular/core';
import { findItem, variantsOf } from '../../../core/data/catalog';
import { blockedTiles, checkObject, objectAtVisual, rectFromCorners } from '../../../core/plan/placement';
import { coverageLayout, usesCoverageLayout } from '../../../core/plan/coverage-layout';
import { PlannerStore, Tool } from '../../../core/planner-store';
import { MapRenderer, Preview } from './map-renderer';

type Drag = (
  | { kind: 'rect'; startX: number; startY: number }
  | { kind: 'move'; uids: number[]; startX: number; startY: number }
  | { kind: 'pan'; lastX: number; lastY: number }
) & {
  /** Tool and item the drag started with; switching either cancels it. */
  tool: Tool;
  itemId: string | null;
};

/** Hosts the PixiJS canvas and turns pointer input into planner edits. */
@Component({
  selector: 'app-map-canvas',
  host: {
    class: 'map-canvas',
    '(document:keydown.space)': 'spaceHeld = true',
    '(document:keyup.space)': 'spaceHeld = false',
  },
  template: `
    <div
      #host
      class="host"
      role="application"
      aria-label="Farm map. Use the toolbar or keyboard shortcuts to edit."
      tabindex="0"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointerleave)="onPointerLeave()"
      (wheel)="onWheel($event)"
      (contextmenu)="onContextMenu($event)"
    ></div>
    @if (hover(); as tile) {
      <div class="coords" aria-hidden="true">{{ tile.x }}, {{ tile.y }}</div>
    }
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
    .coords, .loading {
      position: absolute; padding: 2px 8px; border-radius: 4px;
      background: rgb(0 0 0 / 0.65); color: #fff; font: 12px/1.6 ui-monospace, monospace; pointer-events: none;
    }
    .coords { left: 8px; bottom: 8px; }
    .loading { left: 50%; top: 50%; transform: translate(-50%, -50%); font-size: 14px; }
  `,
})
export class MapCanvas {
  private readonly store = inject(PlannerStore);
  private readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private renderer: MapRenderer | null = null;
  private drag: Drag | null = null;
  protected spaceHeld = false;

  protected readonly hover = signal<{ x: number; y: number } | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** Right click: open the quick item search at the given screen position. */
  readonly quickSearch = output<{ x: number; y: number }>();
  /** Select-tool click (without dragging) on an object that has variants. */
  readonly variantRequest = output<{ uid: number; x: number; y: number }>();

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
        patched: (patch) => renderer.applyPatch(patch),
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
      // Switching tools or items cancels a drag started with the old ones. Effects run after
      // change detection, so a drag may already have started with the new tool by now.
      const tool = this.store.tool();
      const itemId = this.store.activeItem()?.id ?? null;
      untracked(() => {
        if (this.drag && (this.drag.tool !== tool || this.drag.itemId !== itemId)) this.drag = null;
        this.updatePreview();
      });
    });
  }

  zoomIn(): void {
    this.renderer?.zoomAt(1.25);
  }

  zoomOut(): void {
    this.renderer?.zoomAt(0.8);
  }

  fit(): void {
    this.renderer?.fitToView();
  }

  panBy(dx: number, dy: number): void {
    this.renderer?.panBy(dx, dy);
  }

  /** Abandons an in-progress drag. Returns true if there was one. */
  cancel(): boolean {
    if (!this.drag) return false;
    this.drag = null;
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
    renderer.setRestrictionOverlay(options.restrictionOverlay, this.store.restrictions);
    renderer.setAlwaysShowRanges(options.alwaysShowRanges);
  }

  // --- Pointer input -------------------------------------------------------

  protected onPointerDown(event: PointerEvent): void {
    const renderer = this.renderer;
    if (!renderer) return;
    this.hostRef().nativeElement.focus();
    if (event.button === 1 || (event.button === 0 && this.spaceHeld)) {
      event.preventDefault();
      this.drag = { kind: 'pan', lastX: event.clientX, lastY: event.clientY, ...this.dragContext() };
      this.capture(event);
      return;
    }
    if (event.button !== 0) return;

    const tile = renderer.toTile(event.clientX, event.clientY);
    if (this.store.tool() === 'select') {
      const hit = objectAtVisual(this.store.doc, tile.x, tile.y);
      if (hit) {
        const selection = this.store.selection();
        const uids = selection.includes(hit.uid) ? [...selection] : [hit.uid];
        if (!selection.includes(hit.uid)) this.store.selection.set(uids);
        this.drag = { kind: 'move', uids, startX: tile.x, startY: tile.y, ...this.dragContext() };
      } else {
        this.store.selection.set([]);
        this.drag = { kind: 'rect', startX: tile.x, startY: tile.y, ...this.dragContext() };
      }
    } else {
      this.drag = { kind: 'rect', startX: tile.x, startY: tile.y, ...this.dragContext() };
    }
    this.capture(event);
    this.updatePreview();
  }

  protected onPointerMove(event: PointerEvent): void {
    const renderer = this.renderer;
    if (!renderer) return;
    if (this.drag?.kind === 'pan') {
      renderer.panBy(event.clientX - this.drag.lastX, event.clientY - this.drag.lastY);
      this.drag = { ...this.drag, lastX: event.clientX, lastY: event.clientY };
      return;
    }
    const tile = renderer.toTile(event.clientX, event.clientY);
    const previous = this.hover();
    if (previous?.x === tile.x && previous.y === tile.y) return;
    this.hover.set(tile);
    renderer.setHovered(objectAtVisual(this.store.doc, tile.x, tile.y)?.uid ?? null);
    this.updatePreview();
  }

  protected onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    const renderer = this.renderer;
    this.drag = null;
    if (!drag || !renderer || drag.kind === 'pan') return;
    const tile = renderer.toTile(event.clientX, event.clientY);

    if (drag.kind === 'move') {
      const dx = tile.x - drag.startX;
      const dy = tile.y - drag.startY;
      if (dx === 0 && dy === 0) {
        const clicked = objectAtVisual(this.store.doc, tile.x, tile.y);
        if (clicked && variantsOf(clicked.itemId).length > 1) {
          this.store.selection.set([clicked.uid]);
          this.variantRequest.emit({ uid: clicked.uid, x: event.clientX, y: event.clientY });
        }
      } else {
        this.store.move(drag.uids, dx, dy);
      }
    } else {
      const rect = rectFromCorners(drag.startX, drag.startY, tile.x, tile.y);
      switch (this.store.tool()) {
        case 'eraser':
          this.store.erase(rect);
          break;
        case 'select':
          this.store.selection.set(this.store.doc.objectsInRect(rect.x, rect.y, rect.width, rect.height).map((o) => o.uid));
          break;
        case 'brush': {
          const item = this.store.activeItem();
          if (item?.kind === 'object' && rect.width === 1 && rect.height === 1) {
            // Single click: centre larger objects on the cursor.
            const at = this.objectOrigin(tile.x, tile.y);
            this.store.paint({ ...at, width: item.width, height: item.height });
          } else {
            this.store.paint(rect);
          }
          break;
        }
      }
    }
    this.updatePreview();
  }

  protected onPointerLeave(): void {
    if (this.drag) return;
    this.hover.set(null);
    this.renderer?.setHovered(null);
    this.updatePreview();
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const renderer = this.renderer;
    if (!renderer) return;
    // Pinch gestures arrive as ctrl+wheel; a plain wheel also zooms, like most map editors.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    renderer.zoomAt(factor, event.clientX, event.clientY);
  }

  protected onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    this.cancel();
    this.quickSearch.emit({ x: event.clientX, y: event.clientY });
  }

  private dragContext(): { tool: Tool; itemId: string | null } {
    return { tool: this.store.tool(), itemId: this.store.activeItem()?.id ?? null };
  }

  private capture(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  private objectOrigin(x: number, y: number): { x: number; y: number } {
    const item = this.store.activeItem();
    if (!item) return { x, y };
    return { x: x - Math.floor((item.width - 1) / 2), y: y - Math.floor((item.height - 1) / 2) };
  }

  /** Draws what the current tool would do at the hovered tile. */
  private updatePreview(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const tile = this.hover();
    if (!tile) {
      renderer.setPreview(null);
      return;
    }
    const store = this.store;
    const options = store.options();
    const drag = this.drag;
    const preview: Preview = {};

    if (drag?.kind === 'move') {
      const dx = tile.x - drag.startX;
      const dy = tile.y - drag.startY;
      const ignore = new Set(drag.uids);
      preview.ghosts = [];
      preview.blocked = [];
      for (const uid of drag.uids) {
        const obj = store.doc.object(uid);
        const item = obj && findItem(obj.itemId);
        if (!obj || !item) continue;
        preview.ghosts.push({ item, x: obj.x + dx, y: obj.y + dy });
        preview.blocked.push(...checkObject(store.doc, store.restrictions, item, obj.x + dx, obj.y + dy, options, ignore).blocked);
      }
    } else if (drag?.kind === 'rect') {
      const rect = rectFromCorners(drag.startX, drag.startY, tile.x, tile.y);
      const tool = store.tool();
      const item = store.activeItem();
      preview.rect = { ...rect, style: tool === 'eraser' ? 'erase' : tool === 'select' ? 'select' : 'brush' };
      if (tool === 'brush' && item?.kind === 'tile') {
        preview.blocked = blockedTiles(store.doc, store.restrictions, item, rect, options);
      } else if (tool === 'brush' && item && usesCoverageLayout(item) && (rect.width > 1 || rect.height > 1)) {
        // Show where the sprinklers or scarecrows will go and what they'll cover.
        preview.ghosts = coverageLayout(store.doc, store.restrictions, item, rect, options).map((at) => ({ item, ...at }));
      }
    } else if (store.tool() === 'brush') {
      const item = store.activeItem();
      if (item?.kind === 'object') {
        const at = this.objectOrigin(tile.x, tile.y);
        preview.ghosts = [{ item, ...at }];
        preview.blocked = checkObject(store.doc, store.restrictions, item, at.x, at.y, options).blocked;
      } else if (item) {
        preview.rect = { x: tile.x, y: tile.y, width: 1, height: 1, style: 'brush' };
        preview.blocked = blockedTiles(store.doc, store.restrictions, item, preview.rect, options);
      }
    } else if (store.tool() === 'eraser') {
      preview.rect = { x: tile.x, y: tile.y, width: 1, height: 1, style: 'erase' };
    }
    renderer.setPreview(preview);
  }
}
