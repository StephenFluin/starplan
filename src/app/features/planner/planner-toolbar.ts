import { Component, inject, input, output, signal } from '@angular/core';
import { CATALOG, RangeGroup } from '../../core/data/catalog';
import { MapSeason } from '../../core/data/game-art';
import { BrushShape, PlannerStore, RestrictionOverlay, Tool } from '../../core/planner-store';
import { NgTemplateOutlet } from '@angular/common';
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
  imports: [PlansMenu, DismissPopover, NgTemplateOutlet],
  host: { role: 'toolbar', 'aria-label': 'Planner tools' },
  template: `
    <span class="brand">Starplan</span>
    <app-plans-menu />

    <ng-template #farmPicker>
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
    </ng-template>
    <span class="wide"><ng-container *ngTemplateOutlet="farmPicker" /></span>

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
            class="icon"
            [attr.aria-label]="shape.label"
            [attr.aria-pressed]="store.options().brushShape === shape.id"
            [class.active]="store.options().brushShape === shape.id"
            [title]="shape.label + ' (' + shape.key + '): ' + shape.hint"
            (click)="store.setOption('brushShape', shape.id)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path [attr.d]="shape.icon" [class.filled]="shape.id === 'rectangle'" /></svg>
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

    <!-- On phones the rest goes in a More menu; on wider screens it lines up in the bar. -->
    <div class="more" (appDismissPopover)="moreOpen.set(false)">
      <button
        type="button"
        class="icon more-toggle"
        aria-label="More"
        aria-haspopup="true"
        aria-controls="toolbar-more"
        [attr.aria-expanded]="moreOpen()"
        (click)="moreOpen.update((o) => !o)"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle class="filled" cx="3" cy="8" r="1" /><circle class="filled" cx="8" cy="8" r="1" /><circle class="filled" cx="13" cy="8" r="1" /></svg>
      </button>
      <div id="toolbar-more" class="more-panel" [class.open]="moreOpen()">
        @if (moreOpen()) {
          <ng-container *ngTemplateOutlet="farmPicker" />
        }
        <div class="group" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" title="Zoom out (-)" (click)="action.emit('zoom-out')">−</button>
          <button type="button" title="Fit map to screen (0)" (click)="run('fit')">Fit</button>
          <button type="button" aria-label="Zoom in" title="Zoom in (+)" (click)="action.emit('zoom-in')">+</button>
        </div>

        <div class="menu" (appDismissPopover)="optionsOpen.set(false)">
          <button type="button" aria-haspopup="true" [attr.aria-expanded]="optionsOpen()" (click)="optionsOpen.update((o) => !o)">
            View
          </button>
          @if (optionsOpen()) {
            <div class="popover" role="group" aria-label="View and options">
              <label><input type="checkbox" [checked]="store.options().showGrid" (change)="store.setOption('showGrid', $any($event.target).checked)" /> Grid (G)</label>
              <label><input type="checkbox" [checked]="counterOpen()" (change)="action.emit('toggle-counter')" /> Item count</label>
              <fieldset>
                <legend>Season</legend>
                @for (season of seasons; track season.id) {
                  <label>
                    <input type="radio" name="season" [checked]="store.options().season === season.id" (change)="store.setOption('season', season.id)" />
                    {{ season.label }}
                  </label>
                }
              </fieldset>
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

        <div class="menu" (appDismissPopover)="helpersOpen.set(false)">
          <button type="button" aria-haspopup="true" [attr.aria-expanded]="helpersOpen()" (click)="helpersOpen.update((o) => !o)">Helpers</button>
          @if (helpersOpen()) {
            <div class="popover commands" role="group" aria-label="Helpers">
              @for (command of helperCommands; track command.itemId) {
                <button type="button" (click)="helpersOpen.set(false); moreOpen.set(false); coverCrops.emit(command.itemId)">
                  {{ command.label }}<small>{{ command.hint }}</small>
                </button>
              }
              <div class="with-choice">
                <button type="button" (click)="helpersOpen.set(false); moreOpen.set(false); coverCrops.emit(sprinkler())">
                  Water crops with sprinklers<small>Adds as few as it takes for every crop to be watered</small>
                </button>
                <label>
                  <span class="visually-hidden">Sprinkler type</span>
                  <select [value]="sprinkler()" (change)="sprinkler.set($any($event.target).value)">
                    @for (option of sprinklers; track option.id) {
                      <option [value]="option.id">{{ option.name }}</option>
                    }
                  </select>
                </label>
              </div>
            </div>
          }
        </div>

        <button type="button" class="help" title="Keyboard shortcuts (?)" (click)="run('shortcuts')">
          <span class="glyph" aria-hidden="true">?</span><span class="help-label">Keyboard shortcuts</span>
        </button>

        <span class="spacer"></span>

        <div class="menu" (appDismissPopover)="fileOpen.set(false)">
          <button type="button" aria-haspopup="true" [attr.aria-expanded]="fileOpen()" (click)="fileOpen.update((o) => !o)">File</button>
          @if (fileOpen()) {
            <div class="popover end commands" role="group" aria-label="File">
              @for (command of fileCommands; track command.action) {
                <button type="button" (click)="fileOpen.set(false); run(command.action)">
                  {{ command.label }}<small>{{ command.hint }}</small>
                </button>
              }
            </div>
          }
        </div>
        <button type="button" class="primary share" title="Copy a link to this plan" (click)="run('share')">Share</button>
      </div>
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
    .menu > button, .share, .help { border: 1px solid var(--border); border-radius: 6px; }
    .help { min-width: 30px; font-weight: 600; }
    .help-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .share { border-color: var(--accent); }
    button.icon { display: inline-flex; align-items: center; padding: 5px 8px; }
    button.icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    button.icon svg .filled { fill: currentColor; }
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
    .with-choice { display: grid; gap: 4px; padding-bottom: 4px; }
    .with-choice label { padding: 0 8px; }
    .with-choice select { width: 100%; }
    .spacer { flex: 1; }
    .more, .more-panel { display: contents; }
    .more > .more-toggle, .more-panel > .layout { display: none; }

    /* Phones: the plan, tools and history in two rows, and the rest in the More menu. */
    @media (max-width: 640px), (max-height: 480px) and (pointer: coarse) {
      :host { position: relative; gap: 6px; padding: 6px 8px; }
      .brand, .wide, .glyph, .more-panel .spacer { display: none; }
      app-plans-menu { flex: 1 1 140px; min-width: 0; }
      .more { display: block; margin-left: auto; }
      .more > .more-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; }
      .more-panel { display: none; }
      .more-panel.open {
        position: absolute; top: calc(100% + 4px); right: 8px; z-index: 10; display: grid; gap: 8px;
        width: min(320px, calc(100% - 16px)); max-height: 75dvh; overflow-y: auto; box-sizing: border-box; padding: 10px;
        background: var(--panel); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
      }
      .more-panel > .layout { display: flex; }
      .more-panel select, .menu > button, .help, .share { width: 100%; text-align: left; }
      .more-panel .group button { flex: 1; }
      .more-panel .popover { position: static; min-width: 0; margin-top: 4px; box-shadow: none; }
      .help-label { position: static; width: auto; height: auto; clip-path: none; }
    }
    /* Fingers need bigger targets, and iOS zooms into fields with text under 16px. */
    @media (pointer: coarse) {
      button, select { min-height: 44px; }
      button.icon { min-width: 40px; justify-content: center; }
      select { font-size: 16px; }
      .popover label { min-height: 36px; }
    }
  `,
})
export class PlannerToolbar {
  protected readonly store = inject(PlannerStore);
  readonly action = output<ToolbarAction>();
  /** Fired when the user picks a different layout. */
  readonly layoutChange = output<string>();

  /** Whether the item count panel is open. */
  readonly counterOpen = input(false);

  /** The More menu, which holds most of the bar on phones. */
  protected readonly moreOpen = signal(false);
  protected readonly optionsOpen = signal(false);
  protected readonly fileOpen = signal(false);
  protected readonly helpersOpen = signal(false);
  protected readonly helperCommands: { itemId: string; label: string; hint: string }[] = [
    { itemId: 'scarecrow', label: 'Cover crops with scarecrows', hint: 'Adds as few as it takes for every crop to be in range of one' },
    { itemId: 'deluxe-scarecrow', label: 'Cover crops with deluxe scarecrows', hint: 'The same with deluxe scarecrows, which reach twice as far' },
  ];
  protected readonly sprinklers = CATALOG.filter((item) => item.range?.group === 'sprinkler');
  /** The sprinkler "Water crops" uses. */
  protected readonly sprinkler = signal('q-sprinkler');
  /** A helper should cover every crop with items of this id. */
  readonly coverCrops = output<string>();
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

  protected readonly shapes: { id: BrushShape; label: string; key: string; hint: string; icon: string }[] = [
    { id: 'rectangle', label: 'Rectangle', key: 'R', hint: 'drag to fill an area', icon: 'M3 3h10v10H3z' },
    { id: 'outline', label: 'Outline', key: 'O', hint: 'drag to go around an area’s edge, like a fence', icon: 'M3.5 3.5h9v9h-9z' },
    {
      id: 'rows',
      label: 'Rows',
      key: 'W',
      hint: 'drag to fill an area in pairs of rows with walkways between, for trellis crops or machines',
      icon: 'M3 3.5h10M3 6h10M3 10h10M3 12.5h10',
    },
    { id: 'freehand', label: 'Freehand', key: 'F', hint: 'drag to paint along the way', icon: 'M2.5 11c2-5 4-6 5-3s3 2 6-4' },
  ];

  protected readonly seasons: { id: MapSeason; label: string }[] = [
    { id: 'spring', label: 'Spring' },
    { id: 'summer', label: 'Summer' },
    { id: 'fall', label: 'Fall' },
    { id: 'winter', label: 'Winter' },
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

  /** Emits an action, closing the More menu it may have come from. */
  protected run(action: ToolbarAction): void {
    this.moreOpen.set(false);
    this.action.emit(action);
  }

  protected changeLayout(select: HTMLSelectElement): void {
    this.layoutChange.emit(select.value);
    // If the switch was declined the layout signal is unchanged, so restore the select by hand.
    select.value = this.store.layout().id;
  }
}
