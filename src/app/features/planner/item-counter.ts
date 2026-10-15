import { Component, inject, output } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { CatalogItem, spriteUrl } from '../../core/data/catalog';
import { PlannerStore } from '../../core/planner-store';

/** Panel listing how many of each item the plan uses, for shopping lists. */
@Component({
  selector: 'app-item-counter',
  imports: [NgOptimizedImage],
  host: { role: 'region', 'aria-labelledby': 'item-counter-title' },
  template: `
    <header>
      <h2 id="item-counter-title">Item count</h2>
      <button type="button" aria-label="Close item count" (click)="closed.emit()">✕</button>
    </header>
    <table>
      <caption class="visually-hidden">Number of each item placed on the farm</caption>
      <thead class="visually-hidden">
        <tr><th scope="col">Item</th><th scope="col">Count</th></tr>
      </thead>
      <tbody>
        @for (entry of store.counts(); track entry.item.id) {
          <tr>
            <th scope="row">
              <img [ngSrc]="sprite(entry.item)" alt="" width="20" height="20" />
              {{ entry.item.name }}
            </th>
            <td>{{ entry.count }}</td>
          </tr>
        } @empty {
          <tr><td colspan="2" class="empty">Nothing placed yet.</td></tr>
        }
      </tbody>
    </table>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; padding: 8px; }
    header { display: flex; align-items: center; justify-content: space-between; }
    h2 { margin: 0; font-size: 14px; }
    header button { border: 0; background: transparent; color: var(--text); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
    header button:hover { background: var(--hover); }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; overflow-y: auto; display: block; }
    tbody { display: table; width: 100%; }
    th { font-weight: normal; text-align: left; display: flex; align-items: center; gap: 6px; padding: 2px 0; }
    td { text-align: right; font-variant-numeric: tabular-nums; }
    td.empty { text-align: left; color: var(--muted); }
    img { image-rendering: pixelated; object-fit: contain; }
    @media (pointer: coarse) {
      header button { min-width: 44px; min-height: 44px; }
    }
  `,
})
export class ItemCounter {
  protected readonly store = inject(PlannerStore);
  readonly closed = output<void>();

  protected sprite(item: CatalogItem): string {
    return spriteUrl(item);
  }
}
