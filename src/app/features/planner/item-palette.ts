import { Component, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { CATALOG, CATEGORIES, Category, CatalogItem, spriteUrl } from '../../core/data/catalog';
import { PlannerStore } from '../../core/planner-store';

/** Sidebar listing every placeable item, grouped by category and filterable. */
@Component({
  selector: 'app-item-palette',
  imports: [NgOptimizedImage],
  template: `
    <label class="search">
      <span class="visually-hidden">Search items</span>
      <input type="search" placeholder="Search items…" [value]="query()" (input)="query.set($any($event.target).value)" />
    </label>
    <div class="tabs" role="tablist" aria-label="Item categories">
      @for (category of categories; track category.id) {
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="category.id === activeCategory()"
          [class.active]="category.id === activeCategory()"
          (click)="activeCategory.set(category.id); query.set('')"
        >
          {{ category.name }}
        </button>
      }
    </div>
    <ul class="items" role="listbox" aria-label="Items">
      @for (item of visibleItems(); track item.id) {
        <li>
          <button
            type="button"
            role="option"
            [attr.aria-selected]="isActive(item)"
            [class.active]="isActive(item)"
            [title]="item.name"
            (click)="store.selectItem(item)"
          >
            <img [ngSrc]="sprite(item)" alt="" width="32" height="32" />
            <span>{{ item.name }}</span>
          </button>
        </li>
      } @empty {
        <li class="empty">No items match “{{ query() }}”.</li>
      }
    </ul>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; gap: 8px; padding: 8px; }
    .search input {
      width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px;
      border: 1px solid var(--border); background: var(--input-bg); color: var(--text);
    }
    .tabs { display: flex; flex-wrap: wrap; gap: 4px; }
    .tabs button {
      padding: 4px 8px; border-radius: 999px; border: 1px solid var(--border);
      background: transparent; color: var(--text); font-size: 12px; cursor: pointer;
    }
    .tabs button.active { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
    .items { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: grid; gap: 2px; }
    .items button {
      display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 6px; border-radius: 6px;
      border: 1px solid transparent; background: transparent; color: var(--text); text-align: left; cursor: pointer;
    }
    .items button:hover { background: var(--hover); }
    .items button.active { border-color: var(--accent); background: var(--selected); }
    .items img { image-rendering: pixelated; object-fit: contain; flex: none; }
    .empty { padding: 8px; color: var(--muted); }
  `,
})
export class ItemPalette {
  protected readonly store = inject(PlannerStore);
  protected readonly categories = CATEGORIES;
  protected readonly activeCategory = signal<Category>('paths');
  protected readonly query = signal('');

  protected readonly visibleItems = computed(() => {
    const query = this.query().trim().toLowerCase();
    if (query) {
      return CATALOG.filter((item) => item.name.toLowerCase().includes(query));
    }
    return CATALOG.filter((item) => item.category === this.activeCategory());
  });

  protected sprite(item: CatalogItem): string {
    return spriteUrl(item);
  }

  /** Whether the Place tool is putting down this item. */
  protected isActive(item: CatalogItem): boolean {
    return item.id === this.store.activeItem()?.id && this.store.tool() === 'brush' && !this.store.pasting();
  }
}
