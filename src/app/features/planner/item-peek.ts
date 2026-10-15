import { Component, ElementRef, computed, inject, model, viewChild } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { CatalogItem, findItem, spriteUrl } from '../../core/data/catalog';
import { PlannerStore } from '../../core/planner-store';

/**
 * On phones, the bar the item list folds into below the map: the item being placed, which opens
 * the whole list, and the ones used lately, a tap away. Hidden on wider screens, where the list
 * always shows.
 */
@Component({
  selector: 'app-item-peek',
  imports: [NgOptimizedImage],
  template: `
    <button #toggle type="button" class="current" aria-controls="item-sheet" [attr.aria-expanded]="open()" (click)="open.update((o) => !o)">
      @if (store.activeItem(); as item) {
        <img [ngSrc]="sprite(item)" alt="" width="32" height="32" />
      }
      <span class="name"><span class="visually-hidden">Items: </span>{{ store.activeItem()?.name ?? 'Choose an item' }}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
    </button>
    @if (recent().length) {
      <ul aria-label="Recently used items">
        @for (item of recent(); track item.id) {
          <li>
            <button type="button" [attr.aria-label]="item.name" [title]="item.name" (click)="choose(item)">
              <img [ngSrc]="sprite(item)" alt="" width="32" height="32" />
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: none; }
    @media (max-width: 640px), (max-height: 480px) and (pointer: coarse) {
      :host { display: flex; align-items: center; gap: 8px; padding: 6px 8px; }
    }
    button { border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text); font: inherit; cursor: pointer; }
    .current {
      flex: 1 1 auto; min-width: 0; min-height: 48px; display: flex; align-items: center; gap: 8px; padding: 4px 8px;
      border-color: var(--border); background: var(--button-bg); text-align: left;
    }
    .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    svg { flex: none; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    [aria-expanded='true'] svg { transform: rotate(180deg); }
    ul { display: flex; gap: 2px; margin: 0; padding: 0; list-style: none; overflow-x: auto; max-width: 60%; }
    ul button { display: grid; place-items: center; width: 44px; height: 48px; padding: 0; }
    img { image-rendering: pixelated; object-fit: contain; flex: none; }
  `,
})
export class ItemPeek {
  protected readonly store = inject(PlannerStore);
  private readonly toggle = viewChild.required<ElementRef<HTMLButtonElement>>('toggle');
  /** Whether the item list is unfolded above the bar. */
  readonly open = model(false);

  /** Recently used items other than the one being placed. */
  protected readonly recent = computed(() => {
    const active = this.store.activeItem()?.id;
    return this.store
      .recentItems()
      .filter((id) => id !== active)
      .map((id) => findItem(id))
      .filter((item): item is CatalogItem => Boolean(item));
  });

  /** Moves focus to the button that opens the list, as when it closes with focus inside. */
  focus(): void {
    this.toggle().nativeElement.focus();
  }

  protected choose(item: CatalogItem): void {
    this.store.selectItem(item);
    this.open.set(false);
  }

  protected sprite(item: CatalogItem): string {
    return spriteUrl(item);
  }
}
