import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { LocalPlanInfo } from '../../core/local-plans';
import { PlannerStore } from '../../core/planner-store';
import { DismissPopover } from './dismiss-popover';

/** Toolbar menu for plans saved in this browser, with the open plan's save status. */
@Component({
  selector: 'app-plans-menu',
  imports: [DatePipe],
  hostDirectives: [DismissPopover],
  template: `
    <button type="button" class="trigger" aria-haspopup="true" [attr.aria-expanded]="open()" (click)="open.update((o) => !o)">
      <span class="name">{{ store.planName() }}</span>
      <span class="status" [class.error]="store.saveState() === 'error'">{{ statusText() }}</span>
    </button>
    @if (open()) {
      <div class="popover" role="group" aria-label="Saved plans">
        <label class="rename">
          <span>Plan name</span>
          <input
            type="text"
            [value]="store.planName()"
            (change)="store.renamePlan(store.planId(), $any($event.target).value)"
            (keydown.enter)="$any($event.target).blur()"
          />
        </label>
        <p class="heading">Saved in this browser</p>
        <ul>
          @for (plan of otherPlans(); track plan.id) {
            <li>
              <button type="button" class="open" (click)="openPlan(plan)">
                <span>{{ plan.name }}</span>
                <small>{{ layoutName(plan.layout) }} · {{ plan.updatedAt | date: 'short' }}</small>
              </button>
              <button type="button" class="delete" [attr.aria-label]="'Delete ' + plan.name" (click)="deletePlan(plan)">✕</button>
            </li>
          } @empty {
            <li class="empty">No other plans yet. Starting a new plan, opening a shared link or importing a file adds one here.</li>
          }
        </ul>
        @if (store.saveState() !== 'empty') {
          <button type="button" class="delete-current" (click)="deleteCurrent()">Delete this plan</button>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; }
    .trigger {
      display: flex; flex-direction: column; align-items: flex-start; gap: 0; padding: 3px 10px; max-width: 220px;
      border: 1px solid var(--border); border-radius: 6px; background: var(--button-bg); color: var(--text); font: inherit; cursor: pointer;
    }
    .trigger:hover { background: var(--hover); }
    .name { font-size: 13px; font-weight: 600; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status { font-size: 11px; color: var(--muted); }
    .status.error { color: #fca5a5; }
    .popover {
      position: absolute; top: calc(100% + 4px); left: 0; z-index: 10; width: 300px; padding: 10px;
      display: grid; gap: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.45); font-size: 13px;
    }
    .rename { display: grid; gap: 4px; color: var(--muted); }
    input {
      padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--input-bg); color: var(--text); font: inherit;
    }
    .heading { margin: 4px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    ul { list-style: none; margin: 0; padding: 0; max-height: 300px; overflow-y: auto; display: grid; gap: 2px; }
    li { display: flex; align-items: stretch; gap: 2px; }
    li.empty { color: var(--muted); padding: 4px; }
    button.open {
      flex: 1; display: grid; text-align: left; padding: 4px 6px; border-radius: 6px; border: 0;
      background: transparent; color: var(--text); font: inherit; cursor: pointer;
    }
    button.open small { color: var(--muted); }
    button.open:hover, button.delete:hover { background: var(--hover); }
    button.delete { border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; padding: 0 8px; }
    .delete-current {
      justify-self: start; border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px;
      background: transparent; color: #fca5a5; font: inherit; cursor: pointer;
    }
  `,
})
export class PlansMenu {
  protected readonly store = inject(PlannerStore);
  protected readonly open = signal(false);

  constructor() {
    inject(DismissPopover).appDismissPopover.subscribe(() => this.open.set(false));
  }

  protected readonly otherPlans = computed(() => this.store.savedPlans().filter((p) => p.id !== this.store.planId()));

  protected readonly statusText = computed(() => {
    switch (this.store.saveState()) {
      case 'empty':
        return 'Not saved yet';
      case 'saving':
        return 'Saving…';
      case 'saved':
        return 'Saved in this browser';
      case 'error':
        return 'Could not save (storage full or blocked)';
    }
  });

  protected layoutName(id: string): string {
    return this.store.layouts.find((l) => l.id === id)?.name ?? id;
  }

  protected async openPlan(plan: LocalPlanInfo): Promise<void> {
    this.open.set(false);
    await this.store.openPlan(plan.id);
  }

  protected async deletePlan(plan: LocalPlanInfo): Promise<void> {
    if (confirm(`Delete “${plan.name}”? This can't be undone.`)) await this.store.deletePlan(plan.id);
  }

  protected async deleteCurrent(): Promise<void> {
    if (confirm(`Delete “${this.store.planName()}”? This can't be undone.`)) {
      this.open.set(false);
      await this.store.deletePlan(this.store.planId());
    }
  }
}
