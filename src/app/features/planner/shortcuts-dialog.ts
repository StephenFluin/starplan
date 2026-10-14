import { Component, ElementRef, afterNextRender, output, viewChild } from '@angular/core';

interface Shortcut {
  keys: readonly string[];
  action: string;
}

/** On Apple keyboards the shortcuts use ⌘ rather than Ctrl. */
export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

const SECTIONS: readonly { title: string; shortcuts: readonly Shortcut[] }[] = [
  {
    title: 'Moving around',
    shortcuts: [
      { keys: ['Drag empty ground'], action: 'Move the map (Select tool)' },
      { keys: ['Right-drag', 'Space + drag'], action: 'Move the map with any tool' },
      { keys: ['Scroll', 'Pinch'], action: 'Zoom in or out where the pointer is' },
      { keys: ['Double-click'], action: 'Zoom in there (Shift: out)' },
      { keys: ['+', '−', '0'], action: 'Zoom in, zoom out, fit the map' },
      { keys: ['Arrow keys'], action: 'Move the map a tile, when nothing is selected; on the map, a cursor marks the middle tile' },
      { keys: [`${MOD} + arrows`], action: 'Move the cursor five tiles' },
      { keys: ['Shift + arrows'], action: 'Stretch a rectangle from the cursor, for Enter to fill, outline, erase or select' },
      { keys: ['Enter'], action: 'Place, select or erase at the cursor (Shift + Enter: add to the selection)' },
    ],
  },
  {
    title: 'Tools',
    shortcuts: [
      { keys: ['B'], action: 'Place' },
      { keys: ['S'], action: 'Select (press again to go back)' },
      { keys: ['E'], action: 'Erase (press again to go back)' },
      { keys: ['R', 'O', 'W', 'F'], action: 'Drag to fill a rectangle, go around its edge, fill it in rows with walkways, or freehand' },
      { keys: ['G'], action: 'Show or hide the grid' },
    ],
  },
  {
    title: 'Placing',
    shortcuts: [
      { keys: ['Click', 'Drag'], action: 'Place one, or fill or paint along a drag' },
      { keys: ['Right-click', 'Long press'], action: 'Search for an item' },
      { keys: ['Alt + click', 'I'], action: 'Pick up the item under the pointer' },
    ],
  },
  {
    title: 'Selecting and editing',
    shortcuts: [
      { keys: ['Click'], action: 'Select an object (and change its type, if it has others)' },
      { keys: ['Shift + click'], action: 'Add an object to the selection, or take it out' },
      { keys: ['Shift + drag'], action: 'Select an area, ground included' },
      { keys: ['Drag the selection'], action: 'Move it' },
      { keys: ['Arrow keys'], action: 'Nudge the selection a tile (Shift: five)' },
      { keys: ['V'], action: 'Switch the selected object to its next type' },
      { keys: ['Delete'], action: 'Delete the selection' },
      { keys: [`${MOD} + A`], action: 'Select everything' },
      { keys: [`${MOD} + C`, `${MOD} + X`], action: 'Copy or cut the selection' },
      { keys: [`${MOD} + V`, `${MOD} + D`], action: 'Paste, or duplicate the selection; then click to put copies down' },
      { keys: ['Esc'], action: 'Cancel a drag, stop pasting, or clear the selection' },
    ],
  },
  {
    title: 'History',
    shortcuts: [
      { keys: [`${MOD} + Z`], action: 'Undo' },
      { keys: [`${MOD} + Shift + Z`, `${MOD} + Y`], action: 'Redo' },
      { keys: ['?'], action: 'Show this list' },
    ],
  },
];

/** A modal list of every keyboard shortcut and mouse gesture. */
@Component({
  selector: 'app-shortcuts-dialog',
  template: `
    <dialog #dialog aria-labelledby="shortcuts-title" (close)="closed.emit()" (click)="onBackdropClick($event)">
      <header>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button type="button" aria-label="Close" (click)="dialog.close()">✕</button>
      </header>
      <div class="sections">
        @for (section of sections; track section.title) {
          <section>
            <h3>{{ section.title }}</h3>
            <dl>
              @for (shortcut of section.shortcuts; track shortcut.action) {
                <dt>
                  @for (key of shortcut.keys; track key; let last = $last) {
                    <kbd>{{ key }}</kbd>
                    @if (!last) {
                      <span class="or">or</span>
                    }
                  }
                </dt>
                <dd>{{ shortcut.action }}</dd>
              }
            </dl>
          </section>
        }
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(760px, calc(100vw - 32px)); max-height: calc(100dvh - 64px); padding: 0; overflow: auto;
      background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: 0 16px 48px rgb(0 0 0 / 0.6);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.5); }
    header {
      position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; background: var(--panel); border-bottom: 1px solid var(--border);
    }
    h2 { margin: 0; font-size: 16px; }
    header button { border: 0; border-radius: 6px; padding: 4px 8px; background: transparent; color: var(--text); font: inherit; cursor: pointer; }
    header button:hover { background: var(--hover); }
    .sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 8px 24px; padding: 12px 16px 16px; }
    h3 { margin: 4px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 13px; }
    dt { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    dd { margin: 0; align-self: center; }
    kbd {
      padding: 1px 6px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px;
      background: var(--input-bg); font: 12px/1.5 ui-monospace, monospace; white-space: nowrap;
    }
    .or { color: var(--muted); font-size: 12px; }
  `,
})
export class ShortcutsDialog {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  readonly closed = output<void>();
  protected readonly sections = SECTIONS;

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  /** A click on the backdrop (the dialog element itself, outside its content) closes it. */
  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }
}
