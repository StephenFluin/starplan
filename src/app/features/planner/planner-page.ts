import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Analytics } from '../../core/analytics';
import { NO_SELECTION, PlannerStore, Tool, isEmptySelection } from '../../core/planner-store';
import { SaveImportError, importSave } from '../../core/plan/save-import';
import { parsePlanJson } from '../../core/plan/serialize';
import { blockedMessage } from './block-message';
import { ItemCounter } from './item-counter';
import { ItemPalette } from './item-palette';
import { MapCanvas } from './map/map-canvas';
import { PlannerToolbar, ToolbarAction } from './planner-toolbar';
import { QuickSearch } from './quick-search';
import { SelectionAction, SelectionBar, describeGroup } from './selection-bar';
import { MOD, ShortcutsDialog } from './shortcuts-dialog';
import { VariantPicker } from './variant-picker';
import { CatalogItem } from '../../core/data/catalog';

const PAN_STEP = 64;
/** How long longer messages (what an import left out) stay up, in milliseconds. */
const LONG_MESSAGE = 10_000;

const SAVE_ERRORS: Record<SaveImportError, string> = {
  'not-a-save': 'That file is not a plan or a Stardew Valley save this planner can read.',
  'save-info': "That's the save's SaveGameInfo file. Pick the other file in the same folder: the one named like the folder.",
  'unknown-farm': 'That save is on a farm type from a mod, which the planner has no map for.',
};
/** Tiles Shift + an arrow key moves the selection or the keyboard cursor. */
const NUDGE_LARGE = 5;

@Component({
  selector: 'app-planner-page',
  imports: [PlannerToolbar, ItemPalette, MapCanvas, ItemCounter, QuickSearch, VariantPicker, ShortcutsDialog, SelectionBar],
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
        @if (store.pasting() || hasSelection()) {
          <app-selection-bar (action)="onSelectionAction($event)" (changeType)="openVariantPicker($event.uid, $event.anchor)" />
        }
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
    <!-- Save files have no extension, so this one takes any file. -->
    <input #saveInput type="file" hidden (change)="importFile($event)" />
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
    main { position: relative; flex: 1; min-width: 0; display: flex; }
    app-selection-bar { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 5; max-width: calc(100% - 16px); }
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
  protected readonly store = inject(PlannerStore);
  private readonly analytics = inject(Analytics);
  private readonly map = viewChild.required(MapCanvas);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly saveInput = viewChild.required<ElementRef<HTMLInputElement>>('saveInput');
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
      case 'import-save':
        this.saveInput().nativeElement.click();
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
    const text = await file.text();
    // Save files are XML; plans are JSON.
    if (text.trimStart().startsWith('<')) return this.importSaveFile(text);
    const parsed = parsePlanJson(text);
    if (!parsed) {
      this.announce('That file is not a plan or a Stardew Valley save this planner can read.');
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
    if (mod && (key === 'c' || key === 'x' || key === 'd') && this.hasSelection()) {
      event.preventDefault();
      this.onSelectionAction(key === 'x' ? 'cut' : key === 'c' ? 'copy' : 'duplicate');
      return;
    }
    if (mod && key === 'v') {
      event.preventDefault();
      if (!this.startPasting()) this.announce(`Nothing copied yet. Select something and press ${MOD}+C.`);
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
        if (this.hasSelection()) {
          event.preventDefault();
          this.store.deleteSelection();
        }
        return;
      case 'escape':
        if (map.cancel()) return;
        if (this.store.pasting()) this.store.stopPasting();
        else this.store.selection.set(NO_SELECTION);
        return;
      case 'arrowleft':
      case 'arrowright':
      case 'arrowup':
      case 'arrowdown': {
        // The item list and the item count scroll with the arrow keys.
        if (target instanceof Element && target.closest('app-item-palette, app-item-counter')) return;
        event.preventDefault();
        const x = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0;
        const y = key === 'arrowup' ? -1 : key === 'arrowdown' ? 1 : 0;
        const step = event.shiftKey ? NUDGE_LARGE : 1;
        const onMap = target instanceof Element && target.closest('app-map-canvas') !== null;
        // Arrows nudge the selection a tile (Shift: five), or else move around the map: by whole
        // tiles under the keyboard cursor when the map has focus.
        if (this.hasSelection()) {
          const failure = this.store.moveSelection(x * step, y * step);
          if (failure) this.announce(blockedMessage(failure));
          else if (map.cursorActive) map.moveCursor(x * step, y * step);
        } else if (onMap) {
          map.moveCursor(x * step, y * step);
        } else {
          map.panBy(-x * step * PAN_STEP, -y * step * PAN_STEP);
        }
        return;
      }
    }
  }

  protected hasSelection(): boolean {
    return !isEmptySelection(this.store.selection());
  }

  protected onSelectionAction(action: SelectionAction): void {
    switch (action) {
      case 'copy':
        this.announce(`Copied ${describeGroup(this.store.copySelection())}. Press ${MOD}+V to paste.`);
        return;
      case 'cut':
        this.announce(`Cut ${describeGroup(this.store.cutSelection())}. Press ${MOD}+V to paste.`);
        return;
      case 'duplicate':
        this.store.copySelection();
        this.startPasting();
        return;
      case 'delete':
        this.store.deleteSelection();
        return;
      case 'deselect':
        this.store.selection.set(NO_SELECTION);
        return;
      case 'stop-paste':
        this.store.stopPasting();
        return;
    }
  }

  /** Opens the variant picker for an object, below the given element. */
  protected openVariantPicker(uid: number, anchor: HTMLElement): void {
    const bounds = anchor.getBoundingClientRect();
    this.variantPicker.set({ uid, x: bounds.left, y: bounds.bottom + 4 });
  }

  private startPasting(): boolean {
    if (!this.store.startPasting()) return false;
    this.announce('Click to put down a copy. Press Esc when done.');
    return true;
  }

  private async importSaveFile(xml: string): Promise<void> {
    const result = importSave(xml, this.store.layouts);
    if (typeof result === 'string') {
      this.announce(SAVE_ERRORS[result], LONG_MESSAGE);
      return;
    }
    await this.store.load(result.plan, result.name);
    this.analytics.event({ name: 'import_plan', params: { format: 'save', farm: this.farm() } });
    const left = [...result.skipped].sort((a, b) => b[1] - a[1]);
    const listed = left.slice(0, 3).map(([what, count]) => (count > 1 ? `${what} ×${count}` : what));
    const more = left.slice(3).reduce((sum, [, count]) => sum + count, 0);
    const leftOut = listed.length ? ` Left out: ${listed.join(', ')}${more ? ` and ${more} more` : ''}.` : '';
    this.announce(`Imported ${result.name} from your save.${leftOut}`, LONG_MESSAGE);
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

  protected announce(message: string, duration = 4000): void {
    this.status.set(message);
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.status.set(''), duration);
  }
}
