import { Component, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { CATALOG, CatalogItem, findItem, spriteUrl } from '../../core/data/catalog';
import { PlannerStore } from '../../core/planner-store';

const MAX_RESULTS = 10;

/** Right-click popup: recently used items plus a search over the whole catalog. */
@Component({
  selector: 'app-quick-search',
  imports: [NgOptimizedImage],
  host: {
    role: 'dialog',
    'aria-label': 'Quick item search',
    '[style.--x]': "position().x + 'px'",
    '[style.--y]': "position().y + 'px'",
    '(keydown.escape)': 'closed.emit()',
    '(document:pointerdown)': 'onOutsidePointer($event)',
  },
  template: `
    <input
      #search
      type="search"
      placeholder="Search items…"
      aria-label="Search items"
      aria-controls="quick-search-results"
      [attr.aria-activedescendant]="results().length ? 'quick-search-' + highlighted() : null"
      [value]="query()"
      (input)="query.set($any($event.target).value); highlighted.set(0)"
      (keydown.arrowdown)="move(1, $event)"
      (keydown.arrowup)="move(-1, $event)"
      (keydown.enter)="choose(results()[highlighted()])"
    />
    <p class="heading">{{ query() ? 'Results' : 'Recently used' }}</p>
    <ul id="quick-search-results" role="listbox" aria-label="Items">
      @for (item of results(); track item.id; let i = $index) {
        <li
          [id]="'quick-search-' + i"
          role="option"
          [attr.aria-selected]="i === highlighted()"
          [class.highlighted]="i === highlighted()"
          (pointerenter)="highlighted.set(i)"
          (click)="choose(item)"
        >
          <img [ngSrc]="sprite(item)" alt="" width="24" height="24" />
          {{ item.name }}
        </li>
      } @empty {
        <li class="empty">{{ query() ? 'No matches' : 'Nothing used yet. Type to search.' }}</li>
      }
    </ul>
  `,
  styles: `
    :host {
      position: fixed; z-index: 20; width: 260px; padding: 8px; border-radius: 8px;
      background: var(--panel); color: var(--text); border: 1px solid var(--border);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
      /* Opens at the pointer, moved in from the screen's edges so it all shows. */
      --top: clamp(8px, var(--y), 100dvh - 410px);
      left: clamp(8px, var(--x), 100vw - 286px); top: var(--top);
      display: flex; flex-direction: column; max-height: calc(100dvh - 26px - var(--top));
    }
    /* On phones, at the top, clear of the keyboard. */
    @media (max-width: 640px), (max-height: 480px) and (pointer: coarse) {
      :host { --top: 8px; left: 8px; right: 8px; width: auto; }
    }
    input {
      width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px;
      border: 1px solid var(--border); background: var(--input-bg); color: var(--text);
    }
    .heading { margin: 8px 4px 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    ul { list-style: none; margin: 0; padding: 0; max-height: 320px; min-height: 0; overflow-y: auto; }
    li { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
    @media (pointer: coarse) {
      input { min-height: 44px; font-size: 16px; }
      li { min-height: 44px; box-sizing: border-box; }
    }
    li.highlighted { background: var(--selected); }
    li.empty { color: var(--muted); cursor: default; }
    img { image-rendering: pixelated; object-fit: contain; }
  `,
})
export class QuickSearch {
  private readonly store = inject(PlannerStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('search');

  readonly position = input.required<{ x: number; y: number }>();
  readonly closed = output<void>();

  protected readonly query = signal('');
  protected readonly highlighted = signal(0);

  protected readonly results = computed<CatalogItem[]>(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) {
      return this.store
        .recentItems()
        .map((id) => findItem(id))
        .filter((item): item is CatalogItem => Boolean(item));
    }
    return CATALOG.filter((item) => item.name.toLowerCase().includes(query)).slice(0, MAX_RESULTS);
  });

  constructor() {
    afterNextRender(() => this.searchInput().nativeElement.focus());
  }

  protected sprite(item: CatalogItem): string {
    return spriteUrl(item);
  }

  protected move(delta: number, event: Event): void {
    event.preventDefault();
    const count = this.results().length;
    if (count) this.highlighted.update((i) => (i + delta + count) % count);
  }

  protected choose(item: CatalogItem | undefined): void {
    if (item) this.store.selectItem(item);
    this.closed.emit();
  }

  protected onOutsidePointer(event: PointerEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.closed.emit();
  }
}
