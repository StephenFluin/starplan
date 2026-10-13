import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Analytics } from '../../core/analytics';
import { NO_SELECTION, PlannerStore, Tool, isEmptySelection } from '../../core/planner-store';
import { Group } from '../../core/plan/placement';
import { parsePlanJson } from '../../core/plan/serialize';
import { blockedMessage } from './block-message';
import { ItemCounter } from './item-counter';
import { ItemPalette } from './item-palette';
import { MapCanvas } from './map/map-canvas';
import { PlannerToolbar, ToolbarAction } from './planner-toolbar';
import { QuickSearch } from './quick-search';
import { ShortcutsDialog } from './shortcuts-dialog';
import { VariantPicker } from './variant-picker';
import { CatalogItem } from '../../core/data/catalog';

const PAN_STEP = 64;

/** "3 objects and 12 tiles", for messages about copying. */
function describeGroup(group: Group | null): string {
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (group?.objects.length) parts.push(count(group.objects.length, 'object'));
  if (group?.tiles.length) parts.push(count(group.tiles.length, 'tile'));
  return parts.join(' and ') || 'nothing';
}
/** Tiles Shift + an arrow key moves the selection. */
const NUDGE_LARGE = 5;

@Component({
  selector: 'app-planner-page',
  imports: [PlannerToolbar, ItemPalette, MapCanvas, ItemCounter, QuickSearch, VariantPicker, ShortcutsDialog],
  host: { '(document:keydown)': 'onKeydown($event)' },
  template: `
    <header>
      <app-planner-toolbar [counterOpen]="counterOpen()" (action)="onAction($event)" (layoutChange)="changeLayout($event)" />
    </header>
    <div class="body">
      <aside aria-label="Items">
        <app-item-palette />
        <footer class="notice">
          Unofficial, non-commercial fan project. Not affiliated with or endorsed by ConcernedApe.
          Stardew Valley and its art © ConcernedApe LLC.
        </footer>
      </aside>
      <main>
        <h1 class="visually-hidden">Stardew Valley farm planner</h1>
        <app-map-canvas
          (quickSearch)="quickSearchAt.set($event)"
          (variantRequest)="variantPicker.set($event)"
          (picked)="announce('Picked ' + $event.name + '.')"
          (blocked)="announce(blockedMessage($event))"
        />
      </main>
      @if (counterOpen()) {
        <aside class="counter" aria-label="Item count"><app-item-counter (closed)="counterOpen.set(false)" /></aside>
      }
    </div>
    @if (quickSearchAt(); as at) {
      <app-quick-search [position]="at" (closed)="quickSearchAt.set(null)" />
    }
    @if (variantPicker(); as picker) {
      <app-variant-picker
        [uid]="picker.uid"
        [position]="picker"
        (closed)="variantPicker.set(null)"
        (blocked)="announceBlocked($event)"
      />
    }
    @if (shortcutsOpen()) {
      <app-shortcuts-dialog (closed)="shortcutsOpen.set(false)" />
    }
    <p class="status" role="status" aria-live="polite">{{ status() }}</p>
    <input #fileInput type="file" accept="application/json,.json" hidden (change)="importFile($event)" />
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100dvh; }
    .body { flex: 1; display: flex; min-height: 0; }
    aside { width: 240px; flex: none; display: flex; flex-direction: column; min-height: 0; background: var(--panel); border-right: 1px solid var(--border); }
    aside > * { flex: 1; min-height: 0; }
    aside > .notice {
      flex: none; margin: 0; padding: 8px 10px; border-top: 1px solid var(--border);
      font-size: 11px; line-height: 1.4; color: var(--muted);
    }
    aside.counter { border-right: 0; border-left: 1px solid var(--border); }
    main { flex: 1; min-width: 0; display: flex; }
    app-map-canvas { flex: 1; }
    .status:empty { display: none; }
    .status {
      position: fixed; bottom: 44px; left: 50%; transform: translateX(-50%); margin: 0; padding: 8px 14px;
      border-radius: 6px; background: var(--panel); border: 1px solid var(--border); box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
    }
    @media (max-width: 720px) {
      aside { width: 180px; }
      aside.counter { position: fixed; right: 0; top: 0; bottom: 0; z-index: 15; }
    }
  `,
})
export class PlannerPage {
  private readonly store = inject(PlannerStore);
  private readonly analytics = inject(Analytics);
  private readonly map = viewChild.required(MapCanvas);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  /** Tool to return to when E or S is pressed again. */
  private previousTool: Tool = 'brush';

  protected readonly counterOpen = signal(false);
  protected readonly shortcutsOpen = signal(false);
  protected readonly quickSearchAt = signal<{ x: number; y: number } | null>(null);
  protected readonly variantPicker = signal<{ uid: number; x: number; y: number } | null>(null);
  protected readonly status = signal('');
  protected readonly blockedMessage = blockedMessage;

  constructor() {
    afterNextRender(async () => {
      if ((await this.store.restore()) === 'shared') this.analytics.event({ name: 'open_shared_plan', params: { farm: this.farm() } });
    });
  }

  protected async onAction(action: ToolbarAction): Promise<void> {
    const map = this.map();
    switch (action) {
      case 'zoom-in':
        return map.zoomIn();
      case 'zoom-out':
        return map.zoomOut();
      case 'fit':
        return map.fit();
      case 'toggle-counter':
        this.counterOpen.update((open) => !open);
        return;
      case 'shortcuts':
        this.shortcutsOpen.set(true);
        return;
      case 'new':
        await this.store.newPlan(this.store.layout().id);
        this.analytics.event({ name: 'new_plan', params: { farm: this.farm(), source: 'new_button' } });
        this.announce('Started a new plan. Earlier plans are under Plans.');
        return;
      case 'import-json':
        this.fileInput().nativeElement.click();
        return;
      case 'export-json':
        this.download(new Blob([JSON.stringify(this.store.snapshot())], { type: 'application/json' }), 'json');
        this.analytics.event({ name: 'export_plan', params: { format: 'json', farm: this.farm() } });
        return;
      case 'export-png': {
        const png = await map.exportPng();
        if (!png) return;
        this.download(png, 'png');
        this.analytics.event({ name: 'export_plan', params: { format: 'png', farm: this.farm() } });
        return;
      }
      case 'share':
        return this.share();
    }
  }

  protected async changeLayout(layoutId: string): Promise<void> {
    await this.store.newPlan(layoutId);
    this.analytics.event({ name: 'new_plan', params: { farm: this.farm(), source: 'farm_picker' } });
    this.announce('Started a new plan on this map. Earlier plans are under Plans.');
  }

  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const parsed = parsePlanJson(await file.text());
    if (!parsed) {
      this.announce('That file is not a plan this planner can read.');
      return;
    }
    await this.store.load(parsed.plan, file.name.replace(/\.json$/i, ''), parsed.legacy);
    this.analytics.event({ name: 'import_plan', params: { format: parsed.legacy ? 'v2' : 'starplan', farm: this.farm() } });
    this.announce(`Imported ${file.name}.`);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target;
    // Typing in fields, and keys in dialogs, aren't shortcuts.
    if (target instanceof Element && target.closest('input, select, textarea, [contenteditable="true"], dialog')) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (mod && key === 'y') {
      event.preventDefault();
      this.store.redo();
      return;
    }
    if (mod && key === 'a') {
      event.preventDefault();
      this.store.tool.set('select');
      this.store.selectAll();
      return;
    }
    if (mod && (key === 'c' || key === 'x' || key === 'd') && !isEmptySelection(this.store.selection())) {
      event.preventDefault();
      if (key === 'x') {
        this.announce(`Cut ${describeGroup(this.store.cutSelection())}. Press Ctrl+V to paste.`);
      } else if (key === 'c') {
        this.announce(`Copied ${describeGroup(this.store.copySelection())}. Press Ctrl+V to paste.`);
      } else {
        this.store.copySelection();
        this.startPasting();
      }
      return;
    }
    if (mod && key === 'v') {
      event.preventDefault();
      if (!this.startPasting()) this.announce('Nothing copied yet. Select something and press Ctrl+C.');
      return;
    }
    if (mod || event.altKey) return;

    const map = this.map();
    switch (key) {
      case '?':
        this.shortcutsOpen.set(true);
        return;
      case 'e':
        return this.toggleTool('eraser');
      case 's':
        return this.toggleTool('select');
      case 'b':
        return this.store.tool.set('brush');
      case 'g':
        return this.store.setOption('showGrid', !this.store.options().showGrid);
      case 'i':
        if (!map.pickHovered()) this.announce('Point at something on the map to pick it up.');
        return;
      case 'r':
        return this.store.setOption('brushShape', 'rectangle');
      case 'f':
        return this.store.setOption('brushShape', 'freehand');
      case 'v': {
        const { objects } = this.store.selection();
        if (objects.length !== 1) return;
        const next = this.store.cycleVariant(objects[0]);
        this.announce(next ? `Changed to ${next.name}.` : 'No other type fits here.');
        return;
      }
      case '+':
      case '=':
        return map.zoomIn();
      case '-':
        return map.zoomOut();
      case '0':
        return map.fit();
      case 'delete':
      case 'backspace':
        if (!isEmptySelection(this.store.selection())) {
          event.preventDefault();
          this.store.deleteSelection();
        }
        return;
      case 'escape':
        if (map.cancel()) return;
        if (this.store.pasting()) this.store.pasting.set(false);
        else this.store.selection.set(NO_SELECTION);
        return;
      case 'arrowleft':
      case 'arrowright':
      case 'arrowup':
      case 'arrowdown': {
        event.preventDefault();
        const x = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0;
        const y = key === 'arrowup' ? -1 : key === 'arrowdown' ? 1 : 0;
        // Arrows nudge the selection a tile (Shift: five), or else move around the map.
        if (isEmptySelection(this.store.selection())) {
          map.panBy(-x * PAN_STEP, -y * PAN_STEP);
        } else {
          const step = event.shiftKey ? NUDGE_LARGE : 1;
          const failure = this.store.moveSelection(x * step, y * step);
          if (failure) this.announce(blockedMessage(failure));
        }
        return;
      }
    }
  }

  private startPasting(): boolean {
    if (!this.store.startPasting()) return false;
    this.announce('Click to put down a copy. Press Esc when done.');
    return true;
  }

  protected announceBlocked(item: CatalogItem): void {
    this.announce(`${item.name} doesn't fit here.`);
  }

  private toggleTool(tool: Tool): void {
    if (this.store.tool() === tool) {
      this.store.tool.set(this.previousTool === tool ? 'brush' : this.previousTool);
    } else {
      this.previousTool = this.store.tool();
      this.store.tool.set(tool);
    }
  }

  private async share(): Promise<void> {
    const url = await this.store.shareUrl();
    history.replaceState(null, '', url);
    this.analytics.event({ name: 'share', params: { method: 'link', content_type: 'plan', farm: this.farm() } });
    try {
      await navigator.clipboard.writeText(url);
      this.announce('Link copied. Anyone with it can open this plan.');
    } catch {
      this.announce('Link added to the address bar. Copy it from there to share.');
    }
  }

  /** The open plan's farm, for analytics. */
  private farm(): string {
    return this.store.layout().id;
  }

  private download(blob: Blob, extension: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `starplan-${this.store.layout().id}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  protected announce(message: string): void {
    this.status.set(message);
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.status.set(''), 4000);
  }
}
