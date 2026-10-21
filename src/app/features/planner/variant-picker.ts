import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { CatalogItem, spriteUrl, variantsOf } from '../../core/data/catalog';
import { PlannerStore } from '../../core/planner-store';

/** Popup for switching a placed object between its variants (upgrades, tiers, styles). */
@Component({
  selector: 'app-variant-picker',
  imports: [NgOptimizedImage],
  host: {
    role: 'dialog',
    'aria-label': 'Change type',
    '[style.--x]': "position().x + 'px'",
    '[style.--y]': "position().y + 'px'",
    '(keydown.escape)': 'closed.emit()',
    '(document:pointerdown)': 'onOutsidePointer($event)',
  },
  template: `
    <p class="heading">Change to</p>
    <div class="options" role="group" aria-label="Variants">
      @for (item of variants(); track item.id) {
        <button
          #option
          type="button"
          [attr.aria-pressed]="item.id === currentId()"
          [class.current]="item.id === currentId()"
          (click)="choose(item)"
        >
          <img [ngSrc]="sprite(item)" alt="" width="32" height="32" />
          <span>{{ item.name }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      z-index: 20;
      min-width: 200px;
      max-width: 280px;
      padding: 8px;
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      border: 1px solid var(--border);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
      /* Opens at the pointer, moved in from the screen's edges, and scrolls if it's still too tall. */
      --top: clamp(8px, var(--y), 100dvh - 240px);
      left: clamp(8px, var(--x), 100vw - 306px);
      top: var(--top);
      max-height: calc(100dvh - 26px - var(--top));
      overflow-y: auto;
    }
    .heading {
      margin: 0 4px 6px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
    }
    .options {
      display: grid;
      gap: 2px;
    }
    button {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: 6px;
      text-align: left;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text);
      font: inherit;
      cursor: pointer;
    }
    button:hover {
      background: var(--hover);
    }
    button.current {
      border-color: var(--accent);
      background: var(--selected);
    }
    img {
      image-rendering: pixelated;
      object-fit: contain;
      flex: none;
    }
    @media (pointer: coarse) {
      button {
        min-height: 44px;
      }
    }
  `,
})
export class VariantPicker {
  private readonly store = inject(PlannerStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly options = viewChildren<ElementRef<HTMLButtonElement>>('option');

  readonly uid = input.required<number>();
  readonly position = input.required<{ x: number; y: number }>();
  readonly closed = output<void>();
  /** Emitted when the chosen variant doesn't fit where the object is. */
  readonly blocked = output<CatalogItem>();

  protected readonly currentId = computed(() => {
    this.store.revision();
    return this.store.doc.object(this.uid())?.itemId ?? null;
  });
  protected readonly variants = computed(() => {
    const id = this.currentId();
    return id ? variantsOf(id) : [];
  });

  constructor() {
    afterNextRender(() => {
      const current = this.variants().findIndex((v) => v.id === this.currentId());
      this.options()[Math.max(0, current)]?.nativeElement.focus();
    });
  }

  protected sprite(item: CatalogItem): string {
    return spriteUrl(item);
  }

  protected choose(item: CatalogItem): void {
    if (this.store.changeVariant(this.uid(), item)) {
      this.closed.emit();
    } else {
      this.blocked.emit(item);
    }
  }

  protected onOutsidePointer(event: PointerEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.closed.emit();
  }
}
