import { Component, inject, output, signal } from '@angular/core';
import { RangeGroup } from '../../core/data/catalog';
import { PlannerStore, RestrictionOverlay, Tool } from '../../core/planner-store';
import { PlansMenu } from './plans-menu';

export type ToolbarAction = 'zoom-in' | 'zoom-out' | 'fit' | 'share' | 'export-png' | 'export-json' | 'import-json' | 'toggle-counter' | 'new';

/** Top bar with tools, history, layout choice, view options and file actions. */
@Component({
  selector: 'app-planner-toolbar',
  imports: [PlansMenu],
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

    <div class="group" role="group" aria-label="History">
      <button type="button" [disabled]="!store.canUndo()" title="Undo (Ctrl+Z)" (click)="store.undo()">Undo</button>
      <button type="button" [disabled]="!store.canRedo()" title="Redo (Ctrl+Shift+Z)" (click)="store.redo()">Redo</button>
    </div>

    <div class="group" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom out" title="Zoom out (-)" (click)="action.emit('zoom-out')">−</button>
      <button type="button" title="Fit map to screen (0)" (click)="action.emit('fit')">Fit</button>
      <button type="button" aria-label="Zoom in" title="Zoom in (+)" (click)="action.emit('zoom-in')">+</button>
    </div>

    <div class="menu">
      <button type="button" aria-haspopup="true" [attr.aria-expanded]="optionsOpen()" (click)="optionsOpen.update((o) => !o)">
        View &amp; options
      </button>
      @if (optionsOpen()) {
        <div class="popover" role="group" aria-label="View and options">
          <label><input type="checkbox" [checked]="store.options().showGrid" (change)="store.setOption('showGrid', $any($event.target).checked)" /> Grid (G)</label>
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

    <span class="spacer"></span>

    <div class="group" role="group" aria-label="File">
      <button type="button" title="Item count" (click)="action.emit('toggle-counter')">Count</button>
      <button type="button" (click)="action.emit('new')">New</button>
      <button type="button" title="Import a plan file (also accepts v2 planner JSON)" (click)="action.emit('import-json')">Import</button>
      <button type="button" (click)="action.emit('export-json')">Export</button>
      <button type="button" (click)="action.emit('export-png')">Image</button>
      <button type="button" class="primary" title="Copy a link to this plan" (click)="action.emit('share')">Share</button>
    </div>
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
    .menu > button { border: 1px solid var(--border); border-radius: 6px; }
    .popover {
      position: absolute; top: calc(100% + 4px); left: 0; z-index: 10; min-width: 240px; padding: 10px;
      display: grid; gap: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.45); font-size: 13px;
    }
    fieldset { margin: 0; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; display: grid; gap: 4px; }
    legend { padding: 0 4px; color: var(--muted); }
    label { display: flex; align-items: center; gap: 6px; }
    .spacer { flex: 1; }
  `,
})
export class PlannerToolbar {
  protected readonly store = inject(PlannerStore);
  readonly action = output<ToolbarAction>();
  /** Fired when the user picks a different layout. */
  readonly layoutChange = output<string>();

  protected readonly optionsOpen = signal(false);
  protected readonly farms = this.store.layouts.filter((l) => l.kind === 'farm');
  protected readonly interiors = this.store.layouts.filter((l) => l.kind === 'interior');
  protected readonly community = this.store.layouts.filter((l) => l.kind === 'community');

  protected readonly tools: { id: Tool; label: string; key: string; hint?: string }[] = [
    { id: 'brush', label: 'Place', key: 'B' },
    { id: 'select', label: 'Select', key: 'S', hint: 'click to select, drag objects to move them, drag empty ground to move the map, Shift + drag to select several' },
    { id: 'eraser', label: 'Erase', key: 'E' },
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
