import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Analytics } from '../../core/analytics';
import { PlannerStore, Tool } from '../../core/planner-store';
import { parsePlanJson } from '../../core/plan/serialize';
import { ItemCounter } from './item-counter';
import { ItemPalette } from './item-palette';
import { MapCanvas } from './map/map-canvas';
import { PlannerToolbar, ToolbarAction } from './planner-toolbar';
import { QuickSearch } from './quick-search';
import { VariantPicker } from './variant-picker';
import { CatalogItem } from '../../core/data/catalog';

const PAN_STEP = 64;

@Component({
  selector: 'app-planner-page',
  imports: [PlannerToolbar, ItemPalette, MapCanvas, ItemCounter, QuickSearch, VariantPicker],
  host: { '(document:keydown)': 'onKeydown($event)' },
  template: `
    <app-planner-toolbar (action)="onAction($event)" (layoutChange)="changeLayout($event)" />
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
        <app-map-canvas (quickSearch)="quickSearchAt.set($event)" (variantRequest)="variantPicker.set($event)" />
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
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); margin: 0; padding: 8px 14px;
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
  protected readonly quickSearchAt = signal<{ x: number; y: number } | null>(null);
  protected readonly variantPicker = signal<{ uid: number; x: number; y: number } | null>(null);
  protected readonly status = signal('');

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
    if (target instanceof Element && target.closest('input, select, textarea, [contenteditable="true"]')) return;
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
    if (mod || event.altKey) return;

    const map = this.map();
    switch (key) {
      case 'e':
        return this.toggleTool('eraser');
      case 's':
        return this.toggleTool('select');
      case 'b':
        return this.store.tool.set('brush');
      case 'g':
        return this.store.setOption('showGrid', !this.store.options().showGrid);
      case 'v': {
        const selection = this.store.selection();
        if (selection.length !== 1) return;
        const next = this.store.cycleVariant(selection[0]);
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
        if (this.store.selection().length) {
          event.preventDefault();
          this.store.deleteSelection();
        }
        return;
      case 'escape':
        if (!map.cancel()) this.store.selection.set([]);
        return;
      case 'arrowleft':
      case 'arrowright':
      case 'arrowup':
      case 'arrowdown': {
        event.preventDefault();
        const dx = key === 'arrowleft' ? PAN_STEP : key === 'arrowright' ? -PAN_STEP : 0;
        const dy = key === 'arrowup' ? PAN_STEP : key === 'arrowdown' ? -PAN_STEP : 0;
        map.panBy(dx, dy);
        return;
      }
    }
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

  private announce(message: string): void {
    this.status.set(message);
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.status.set(''), 4000);
  }
}
