import { Component, inject, input, output, signal } from '@angular/core';
import { RangeGroup } from '../../core/data/catalog';
import { BrushShape, PlannerStore, RestrictionOverlay, Tool } from '../../core/planner-store';
import { DismissPopover } from './dismiss-popover';
import { PlansMenu } from './plans-menu';

export type ToolbarAction =
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'share'
  | 'export-png'
  | 'export-json'
  | 'import-json'
  | 'import-save'
  | 'toggle-counter'
  | 'new'
  | 'shortcuts';

/** Top bar with tools, history, layout choice, view options and file actions. */
@Component({
  selector: 'app-planner-toolbar',
  imports: [PlansMenu, DismissPopover],
  host: { role: 'toolbar', 'aria-label': 'Planner tools' },
  template: `
    <span class="brand">Starplan</span>
    <app-plans-menu />

    <label class="layout">
      <span class="visually-hidden">Farm layout</span>
      <select [value]="store.layout().id" (change)="changeLayout($any($event.target))">
        <optgroup label="Farms">
          @for (layout of farms; track layout.id) {
            <option [value]="layout.id">{{ layout.name }}</option>
          }
        </optgroup>
        <optgroup label="Interiors">
          @for (layout of interiors; track layout.id) {
            <option [value]="layout.id">{{ layout.name }}</option>
          }
        </optgroup>
        @if (community.length) {
          <optgroup label="Community maps">
            @for (layout of community; track layout.id) {
              <option [value]="layout.id">{{ layout.name }}</option>
            }
          </optgroup>
        }
      </select>
    </label>

    <div class="group" role="group" aria-label="Tool">
      @for (tool of tools; track tool.id) {
        <button
          type="button"
          [attr.aria-pressed]="store.tool() === tool.id"
          [class.active]="store.tool() === tool.id"
          [title]="tool.label + ' (' + tool.key + ')' + (tool.hint ? ': ' + tool.hint : '')"
          (click)="store.tool.set(tool.id)"
        >
          {{ tool.label }}
        </button>
      }
    </div>

    @if (store.tool() !== 'select') {
      <div class="group" role="group" aria-label="Brush shape">
        @for (shape of shapes; track shape.id) {
          <button
            type="button"
            [attr.aria-pressed]="store.options().brushShape === shape.id"
            [class.active]="store.options().brushShape === shape.id"
            [title]="shape.label + ' (' + shape.key + '): ' + shape.hint"
            (click)="store.setOption('brushShape', shape.id)"
          >
            {{ shape.label }}
          </button>
        }
      </div>
    }

    <div class="group" role="group" aria-label="History">
      <button type="button" class="icon" aria-label="Undo" title="Undo (Ctrl+Z)" [disabled]="!store.canUndo()" (click)="store.undo()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4 3 7l3 3M3 7h6.5a3.5 3.5 0 0 1 0 7H8" /></svg>
      </button>
      <button type="button" class="icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" [disabled]="!store.canRedo()" (click)="store.redo()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4 3 3-3 3m3-3H6.5a3.5 3.5 0 0 0 0 7H8" /></svg>
      </button>
    </div>

    <div class="group" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom out" title="Zoom out (-)" (click)="action.emit('zoom-out')">−</button>
      <button type="button" title="Fit map to screen (0)" (click)="action.emit('fit')">Fit</button>
      <button type="button" aria-label="Zoom in" title="Zoom in (+)" (click)="action.emit('zoom-in')">+</button>
    </div>

    <div class="menu" (appDismissPopover)="optionsOpen.set(false)">
      <button type="button" aria-haspopup="true" [attr.aria-expanded]="optionsOpen()" (click)="optionsOpen.update((o) => !o)">
        View &amp; options
      </button>
      @if (optionsOpen()) {
        <div class="popover" role="group" aria-label="View and options">
          <label><input type="checkbox" [checked]="store.options().showGrid" (change)="store.setOption('showGrid', $any($event.target).checked)" /> Grid (G)</label>
          <label><input type="checkbox" [checked]="counterOpen()" (change)="action.emit('toggle-counter')" /> Item count</label>
          <fieldset>
            <legend>Show placeable area</legend>
            @for (overlay of overlays; track overlay.id) {
              <label>
                <input
                  type="radio"
                  name="overlay"
                  [checked]="store.options().restrictionOverlay === overlay.id"
                  (change)="store.setOption('restrictionOverlay', overlay.id)"
                />
                {{ overlay.label }}
              </label>
            }
          </fieldset>
          <fieldset>
            <legend>Always show ranges</legend>
            @for (group of rangeGroups; track group.id) {
              <label>
                <input
                  type="checkbox"
                  [checked]="store.options().alwaysShowRanges.includes(group.id)"
                  (change)="store.toggleRangeGroup(group.id)"
                />
                {{ group.label }}
              </label>
            }
          </fieldset>
          <fieldset>
            <legend>Placement</legend>
            <label><input type="checkbox" [checked]="store.options().overwrite" (change)="store.setOption('overwrite', $any($event.target).checked)" /> Paint over existing tiles</label>
            <label><input type="checkbox" [checked]="store.options().anywhere" (change)="store.setOption('anywhere', $any($event.target).checked)" /> Allow placing anywhere</label>
          </fieldset>
        </div>
      }
    </div>

    <button type="button" class="help" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" (click)="action.emit('shortcuts')">?</button>

    <span class="spacer"></span>

    <div class="menu" (appDismissPopover)="fileOpen.set(false)">
      <button type="button" aria-haspopup="true" [attr.aria-expanded]="fileOpen()" (click)="fileOpen.update((o) => !o)">File</button>
      @if (fileOpen()) {
        <div class="popover end commands" role="group" aria-label="File">
          @for (command of fileCommands; track command.action) {
            <button type="button" (click)="fileOpen.set(false); action.emit(command.action)">
              {{ command.label }}<small>{{ command.hint }}</small>
            </button>
          }
        </div>
      }
    </div>
    <button type="button" class="primary share" title="Copy a link to this plan" (click)="action.emit('share')">Share</button>
  `,
  styles: `
    :host {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 10px;
      background: var(--panel); border-bottom: 1px solid var(--border);
    }
    .brand { font-weight: 700; letter-spacing: 0.02em; margin-right: 4px; }
    .group { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
    .group button + button { border-left: 1px solid var(--border); }
    button, select {
      padding: 5px 10px; border: 0; background: var(--button-bg); color: var(--text); font: inherit; font-size: 13px; cursor: pointer;
    }
    select { border: 1px solid var(--border); border-radius: 6px; }
    button:hover:not(:disabled) { background: var(--hover); }
    button:disabled { color: var(--muted); cursor: default; }
    button.active, button.primary { background: var(--accent); color: var(--accent-text); }
    .menu { position: relative; }
    .menu > button, .share, .help { border: 1px solid var(--border); border-radius: 6px; }
    .help { min-width: 30px; font-weight: 600; }
    .share { border-color: var(--accent); }
    button.icon { display: inline-flex; align-items: center; padding: 5px 8px; }
    button.icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .popover {
      position: absolute; top: calc(100% + 4px); left: 0; z-index: 10; min-width: 240px; padding: 10px;
      display: grid; gap: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.45); font-size: 13px;
    }
    fieldset { margin: 0; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; display: grid; gap: 4px; }
    legend { padding: 0 4px; color: var(--muted); }
    label { display: flex; align-items: center; gap: 6px; }
    .popover.end { left: auto; right: 0; }
    .commands { gap: 2px; padding: 6px; }
    .commands button { display: grid; text-align: left; border-radius: 6px; padding: 6px 8px; }
    .commands small { color: var(--muted); font-size: 12px; }
    .spacer { flex: 1; }
  `,
})
export class PlannerToolbar {
  protected readonly store = inject(PlannerStore);
  readonly action = output<ToolbarAction>();
  /** Fired when the user picks a different layout. */
  readonly layoutChange = output<string>();

  /** Whether the item count panel is open. */
  readonly counterOpen = input(false);

  protected readonly optionsOpen = signal(false);
  protected readonly fileOpen = signal(false);
  protected readonly fileCommands: { action: ToolbarAction; label: string; hint: string }[] = [
    { action: 'new', label: 'New plan', hint: 'Start over on this farm. This plan stays under your plans.' },
    { action: 'import-json', label: 'Import plan file…', hint: 'A Starplan or v2 planner .json file' },
    {
      action: 'import-save',
      label: 'Import game save…',
      hint: 'Your farm from Stardew Valley: in the game’s Saves folder, the file named like its folder',
    },
    { action: 'export-json', label: 'Export plan file', hint: 'Save a .json file you can import later' },
    { action: 'export-png', label: 'Save as image', hint: 'The whole map as a .png' },
  ];
  protected readonly farms = this.store.layouts.filter((l) => l.kind === 'farm');
  protected readonly interiors = this.store.layouts.filter((l) => l.kind === 'interior');
  protected readonly community = this.store.layouts.filter((l) => l.kind === 'community');

  protected readonly tools: { id: Tool; label: string; key: string; hint?: string }[] = [
    { id: 'brush', label: 'Place', key: 'B' },
    {
      id: 'select',
      label: 'Select',
      key: 'S',
      hint: 'click an object to select it, Shift + click to add more, Shift + drag to select an area with its ground, drag the selection or the arrow keys to move it, drag empty ground to move the map',
    },
    { id: 'eraser', label: 'Erase', key: 'E' },
  ];

  protected readonly shapes: { id: BrushShape; label: string; key: string; hint: string }[] = [
    { id: 'rectangle', label: 'Rectangle', key: 'R', hint: 'drag to fill an area' },
    { id: 'freehand', label: 'Freehand', key: 'F', hint: 'drag to paint along the way' },
  ];

  protected readonly overlays: { id: RestrictionOverlay; label: string }[] = [
    { id: 'none', label: 'Off' },
    { id: 'buildable', label: 'Buildable' },
    { id: 'tillable', label: 'Tillable' },
  ];

  protected readonly rangeGroups: { id: RangeGroup; label: string }[] = [
    { id: 'sprinkler', label: 'Sprinklers' },
    { id: 'scarecrow', label: 'Scarecrows' },
    { id: 'beehive', label: 'Bee houses' },
    { id: 'junimo', label: 'Junimo huts' },
  ];

  protected changeLayout(select: HTMLSelectElement): void {
    this.layoutChange.emit(select.value);
    // If the switch was declined the layout signal is unchanged, so restore the select by hand.
    select.value = this.store.layout().id;
  }
}
