import { Component, computed, inject, output } from '@angular/core';
import { findItem, variantsOf } from '../../core/data/catalog';
import { Group } from '../../core/plan/placement';
import { PlannerStore } from '../../core/planner-store';
import { MOD } from './shortcuts-dialog';

export type SelectionAction = 'copy' | 'cut' | 'duplicate' | 'delete' | 'deselect' | 'stop-paste';

/** "Coop", "Scarecrow ×4" or "3 objects and 12 tiles": what a selection or the clipboard holds. */
export function describeGroup(group: Group | null): string {
  // All one kind of object: "Coop", "Scarecrow ×4".
  const kinds = new Set(group?.objects.map((obj) => obj.itemId));
  if (group?.objects.length && kinds.size === 1 && !group.tiles.length) {
    const name = findItem(group.objects[0].itemId)?.name ?? 'object';
    return group.objects.length === 1 ? name : `${name} ×${group.objects.length}`;
  }
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (group?.objects.length) parts.push(count(group.objects.length, 'object'));
  if (group?.tiles.length) parts.push(count(group.tiles.length, 'tile'));
  return parts.join(' and ') || 'nothing';
}

/**
 * Says what's selected (or being pasted) and offers what can be done with it, so copying, deleting
 * and the like don't depend on knowing the shortcuts.
 */
@Component({
  selector: 'app-selection-bar',
  host: { role: 'group', '[attr.aria-label]': "store.pasting() ? 'Pasting' : 'Selection'" },
  template: `
    @if (store.pasting()) {
      <span class="summary">Pasting {{ clipboard() }}: click the map to put down copies.</span>
      <button
        type="button"
        class="primary"
        title="Stop pasting (Esc)"
        (click)="action.emit('stop-paste')"
      >
        Done
      </button>
    } @else {
      <span class="summary">{{ summary() }}</span>
      @if (variantUid() !== null) {
        <button
          type="button"
          title="Change type (V)"
          (click)="changeType.emit({ uid: variantUid()!, anchor: $any($event.currentTarget) })"
        >
          Change type
        </button>
      }
      <button type="button" [title]="'Copy (' + mod + '+C)'" (click)="action.emit('copy')">
        Copy
      </button>
      <button type="button" [title]="'Cut (' + mod + '+X)'" (click)="action.emit('cut')">
        Cut
      </button>
      <button
        type="button"
        [title]="'Duplicate (' + mod + '+D): then click to put the copy down'"
        (click)="action.emit('duplicate')"
      >
        Duplicate
      </button>
      <button type="button" title="Delete (Delete)" (click)="action.emit('delete')">Delete</button>
      <button
        type="button"
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        (click)="action.emit('deselect')"
      >
        ✕
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 4px 4px 12px;
      border-radius: 8px;
      background: var(--panel);
      border: 1px solid var(--border);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
      font-size: 13px;
    }
    .summary {
      margin-right: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    button {
      padding: 4px 10px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text);
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover {
      background: var(--hover);
    }
    button.primary {
      background: var(--accent);
      color: var(--accent-text);
    }
    @media (max-width: 640px) {
      :host {
        flex-wrap: wrap;
        justify-content: center;
        padding: 4px;
      }
      .summary {
        flex-basis: 100%;
        margin: 4px 8px;
        text-align: center;
      }
      button {
        padding: 4px 8px;
      }
    }
    @media (pointer: coarse) {
      button {
        min-height: 40px;
      }
    }
  `,
})
export class SelectionBar {
  protected readonly store = inject(PlannerStore);
  protected readonly mod = MOD;
  readonly action = output<SelectionAction>();
  /** "Change type" was pressed: open the variant picker for the object by the button. */
  readonly changeType = output<{ uid: number; anchor: HTMLElement }>();

  protected readonly summary = computed(() => {
    this.store.revision();
    this.store.selection();
    return `${describeGroup(this.store.selectedGroup())} selected`;
  });

  protected readonly clipboard = computed(() => describeGroup(this.store.clipboard()));

  /** The selected object, when it's the only thing selected and has other types to switch to. */
  protected readonly variantUid = computed(() => {
    this.store.revision();
    const { objects, tiles } = this.store.selection();
    const obj = objects.length === 1 && !tiles.length ? this.store.doc.object(objects[0]) : null;
    return obj && variantsOf(obj.itemId).length > 1 ? obj.uid : null;
  });
}
