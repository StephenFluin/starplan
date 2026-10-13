import { PLATFORM_ID, Service, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CatalogItem, RangeGroup, findItem, variantsOf } from './data/catalog';
import { LayoutInfo } from './data/layout-info';
import { LAYOUTS } from './data/layouts';
import { Patch, PlanDocument, emptyPatch, invertPatch, isEmptyPatch } from './plan/plan-document';
import { PlacementOptions, TileRect, erase, moveObjects, paintTiles, placeAt, placeObjects, swapObject } from './plan/placement';
import { RestrictionMap } from './plan/restriction-map';
import { SavedPlan, decodePlan, encodePlan, fromSaved, toSaved } from './plan/serialize';
import { coverageLayout, usesCoverageLayout } from './plan/coverage-layout';
import { addDefaultBuildings, applyEdit, greenhouseDirtShown } from './plan/default-buildings';
import { LocalPlanInfo, LocalPlans, newPlanId } from './local-plans';

export type Tool = 'brush' | 'eraser' | 'select';
export type RestrictionOverlay = 'none' | 'buildable' | 'tillable';
/** Local save status of the open plan. 'empty' means nothing has been edited yet, so nothing is stored. */
export type SaveState = 'empty' | 'saving' | 'saved' | 'error';

export interface PlannerOptions extends PlacementOptions {
  showGrid: boolean;
  restrictionOverlay: RestrictionOverlay;
  /** Range groups drawn for every placed object, not only on hover. */
  alwaysShowRanges: readonly RangeGroup[];
}

/** Renderer hooks: incremental patches, or a full rebuild after a layout/plan load. */
export interface PlanListener {
  patched(patch: Patch): void;
  reset(): void;
}

const OPTIONS_KEY = 'starplan:options';
const AUTOSAVE_DELAY = 500;
const MAX_HISTORY = 200;
const MAX_RECENT = 12;

const DEFAULT_LAYOUT = LAYOUTS.find((l) => l.id === 'regular') ?? LAYOUTS[0];

@Service()
export class PlannerStore {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly listeners = new Set<PlanListener>();
  private undoStack: Patch[] = [];
  private redoStack: Patch[] = [];
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly localPlans = new LocalPlans(this.browser ? browserStorage() : null);

  readonly layouts = LAYOUTS;

  private readonly layoutState = signal<LayoutInfo>(DEFAULT_LAYOUT);
  readonly layout = this.layoutState.asReadonly();

  doc = new PlanDocument(DEFAULT_LAYOUT.width, DEFAULT_LAYOUT.height);
  /** The layout's restrictions, and the same with the greenhouse's dirt patch laid over them. */
  private baseRestrictions = RestrictionMap.open(DEFAULT_LAYOUT.width, DEFAULT_LAYOUT.height);
  private dirtRestrictions: RestrictionMap | null = null;

  /** Where things can go now: the game keeps the greenhouse's dirt patch until the greenhouse moves. */
  get restrictions(): RestrictionMap {
    return this.dirtRestrictions && greenhouseDirtShown(this.doc, this.layoutState()) ? this.dirtRestrictions : this.baseRestrictions;
  }

  /** Bumped after every change to the document, for derived UI state. */
  private readonly revisionState = signal(0);
  readonly revision = this.revisionState.asReadonly();

  private readonly historyState = signal({ undo: 0, redo: 0 });
  readonly canUndo = computed(() => this.historyState().undo > 0);
  readonly canRedo = computed(() => this.historyState().redo > 0);

  /** Starts in Select, where dragging the map moves it like an online map. */
  readonly tool = signal<Tool>('select');
  readonly activeItem = signal<CatalogItem | null>(findItem('road') ?? null);
  readonly recentItems = signal<readonly string[]>([]);
  readonly selection = signal<readonly number[]>([]);
  readonly options = signal<PlannerOptions>({
    anywhere: false,
    overwrite: true,
    showGrid: true,
    restrictionOverlay: 'none',
    alwaysShowRanges: [],
    ...this.readStoredOptions(),
  });

  /** The open plan's id and name in the local plan library. */
  private readonly planIdState = signal(newPlanId());
  readonly planId = this.planIdState.asReadonly();
  readonly planName = signal('Untitled plan');
  readonly saveState = signal<SaveState>('empty');
  /** Plans saved in this browser, most recently edited first. */
  readonly savedPlans = signal<readonly LocalPlanInfo[]>(this.localPlans.list());

  constructor() {
    // View options are a per-browser preference, remembered between visits.
    effect(() => {
      const options = this.options();
      if (!this.browser) return;
      try {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
      } catch {
        // Best-effort preference.
      }
    });
    if (this.browser) {
      // Don't lose the last edit when the tab closes inside the autosave delay.
      addEventListener('pagehide', () => this.flushAutosave());
    }
  }

  /** Placed item counts, most numerous first. */
  readonly counts = computed(() => {
    this.revisionState();
    const counts = new Map<string, number>();
    for (const [, itemId] of this.doc.allTiles()) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    for (const obj of this.doc.allObjects()) counts.set(obj.itemId, (counts.get(obj.itemId) ?? 0) + 1);
    return [...counts]
      .map(([id, count]) => ({ item: findItem(id), count }))
      .filter((entry): entry is { item: CatalogItem; count: number } => Boolean(entry.item))
      .sort((a, b) => b.count - a.count || a.item.name.localeCompare(b.item.name));
  });

  listen(listener: PlanListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  selectItem(item: CatalogItem): void {
    this.activeItem.set(item);
    this.tool.set('brush');
    this.recentItems.update((recent) => [item.id, ...recent.filter((id) => id !== item.id)].slice(0, MAX_RECENT));
  }

  setOption<K extends keyof PlannerOptions>(key: K, value: PlannerOptions[K]): void {
    this.options.update((options) => ({ ...options, [key]: value }));
  }

  toggleRangeGroup(group: RangeGroup): void {
    this.options.update((options) => {
      const groups = options.alwaysShowRanges.includes(group)
        ? options.alwaysShowRanges.filter((g) => g !== group)
        : [...options.alwaysShowRanges, group];
      return { ...options, alwaysShowRanges: groups };
    });
  }

  // --- Editing -------------------------------------------------------------

  /** Applies the active brush to a tile rectangle. */
  paint(rect: TileRect): void {
    const item = this.activeItem();
    if (!item) return;
    const options = this.options();
    if (usesCoverageLayout(item) && (rect.width > 1 || rect.height > 1)) {
      this.commit(placeAt(this.doc, item, coverageLayout(this.doc, this.restrictions, item, rect, options)));
      return;
    }
    this.commit(
      item.kind === 'tile'
        ? paintTiles(this.doc, this.restrictions, item, rect, options)
        : placeObjects(this.doc, this.restrictions, item, rect, options),
    );
  }

  erase(rect: TileRect): void {
    this.commit(erase(this.doc, rect));
  }

  /** Moves objects by an offset. Returns false (and changes nothing) when the move is blocked. */
  move(uids: readonly number[], dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return true;
    const patch = moveObjects(this.doc, this.restrictions, uids, dx, dy, this.options());
    if (!patch) return false;
    this.commit(patch);
    return true;
  }

  /** Switches a placed object to another variant. Returns false when the variant doesn't fit there. */
  changeVariant(uid: number, item: CatalogItem): boolean {
    const obj = this.doc.object(uid);
    if (obj?.itemId === item.id) return true;
    const patch = swapObject(this.doc, this.restrictions, uid, item, this.options());
    if (!patch) return false;
    this.commit(patch);
    return true;
  }

  /** Switches a placed object to the next variant that fits. Returns the new item, or null if none does. */
  cycleVariant(uid: number): CatalogItem | null {
    const obj = this.doc.object(uid);
    const variants = obj ? variantsOf(obj.itemId) : [];
    const current = variants.findIndex((v) => v.id === obj?.itemId);
    for (let step = 1; step < variants.length; step++) {
      const next = variants[(current + step) % variants.length];
      if (this.changeVariant(uid, next)) return next;
    }
    return null;
  }

  deleteSelection(): void {
    const patch = emptyPatch();
    for (const uid of this.selection()) {
      const obj = this.doc.object(uid);
      if (obj) patch.objects.push({ uid, before: obj, after: null });
    }
    this.selection.set([]);
    this.commit(patch);
  }

  commit(patch: Patch): void {
    if (isEmptyPatch(patch)) return;
    applyEdit(this.doc, this.layoutState(), patch);
    this.undoStack.push(patch);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.changed(patch);
  }

  undo(): void {
    const patch = this.undoStack.pop();
    if (!patch) return;
    const inverse = invertPatch(patch);
    this.doc.apply(inverse);
    this.redoStack.push(patch);
    this.pruneSelection();
    this.changed(inverse);
  }

  redo(): void {
    const patch = this.redoStack.pop();
    if (!patch) return;
    this.doc.apply(patch);
    this.undoStack.push(patch);
    this.pruneSelection();
    this.changed(patch);
  }

  // --- Loading & saving ----------------------------------------------------

  /**
   * Starts an empty plan on the given layout, with its default farmhouse and greenhouse.
   * The previous plan stays in the local library. The new one is only stored once edited.
   */
  async newPlan(layoutId: string): Promise<void> {
    this.flushAutosave();
    const layout = await this.switchLayout(layoutId);
    this.doc.apply(this.defaultBuildings(layout));
    this.startPlan(newPlanId(), layout.name, false);
  }

  /**
   * Opens a plan as a new entry in the local library (imports, shared links).
   * v2 imports don't include the default buildings, so they can be added.
   */
  async load(saved: SavedPlan, name: string, addDefaultBuildings = false): Promise<void> {
    this.flushAutosave();
    const layout = await this.switchLayout(saved.layout);
    this.doc.apply(fromSaved(saved, this.doc, layout));
    if (addDefaultBuildings) this.doc.apply(this.defaultBuildings(layout));
    this.startPlan(newPlanId(), name, true);
  }

  /** Opens a plan from the local library. */
  async openPlan(id: string): Promise<boolean> {
    const saved = this.localPlans.read(id);
    if (!saved) return false;
    this.flushAutosave();
    const layout = await this.switchLayout(saved.layout);
    this.doc.apply(fromSaved(saved, this.doc, layout));
    const name = this.localPlans.list().find((p) => p.id === id)?.name ?? 'Untitled plan';
    this.startPlan(id, name, false);
    this.saveState.set('saved');
    return true;
  }

  renamePlan(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (id === this.planIdState()) {
      this.planName.set(trimmed);
      // An unsaved plan gets stored under its new name on the next edit.
      if (this.saveState() !== 'empty') this.flushAutosave(true);
    } else {
      this.localPlans.rename(id, trimmed);
    }
    this.savedPlans.set(this.localPlans.list());
  }

  /** Deletes a plan from the library. Deleting the open plan switches to the next most recent one. */
  async deletePlan(id: string): Promise<void> {
    this.localPlans.remove(id);
    this.savedPlans.set(this.localPlans.list());
    if (id !== this.planIdState()) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = undefined;
    const next = this.savedPlans()[0];
    if (!next || !(await this.openPlan(next.id))) await this.newPlan(this.layoutState().id);
  }

  snapshot(): SavedPlan {
    return toSaved(this.layoutState().id, this.doc);
  }

  /** A link that reopens this exact plan. */
  async shareUrl(): Promise<string> {
    const encoded = await encodePlan(this.snapshot());
    const url = new URL(location.href);
    url.hash = `p=${encoded}`;
    return url.toString();
  }

  /** Opens a shared link if there is one, else the last plan used in this browser, else a fresh plan. */
  async restore(): Promise<void> {
    const hash = this.browser ? new URLSearchParams(location.hash.slice(1)).get('p') : null;
    const fromUrl = hash ? await decodePlan(hash) : null;
    if (fromUrl) {
      await this.load(fromUrl, 'Shared plan');
      // It's now in the library; drop the hash so reloading doesn't import it again.
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    const current = this.localPlans.currentId ?? this.localPlans.migrateLegacyAutosave(newPlanId(), 'My farm', Date.now());
    if (current && (await this.openPlan(current))) return;
    const latest = this.localPlans.list()[0];
    if (latest && (await this.openPlan(latest.id))) return;
    await this.newPlan(DEFAULT_LAYOUT.id);
  }

  private async switchLayout(layoutId: string): Promise<LayoutInfo> {
    const layout = this.layouts.find((l) => l.id === layoutId) ?? DEFAULT_LAYOUT;
    this.baseRestrictions = await this.loadRestrictions(layout);
    const dirt = layout.greenhouseDirt;
    this.dirtRestrictions = dirt ? this.baseRestrictions.withArea(dirt.x, dirt.y, dirt.width, dirt.height, dirt.restrictions) : null;
    this.doc = new PlanDocument(layout.width, layout.height);
    this.selection.set([]);
    this.layoutState.set(layout);
    return layout;
  }

  private async loadRestrictions(layout: LayoutInfo): Promise<RestrictionMap> {
    if (!layout.restrictions || !this.browser) {
      return RestrictionMap.open(layout.width, layout.height);
    }
    try {
      const response = await fetch(`assets/restrictions/${layout.id}.txt`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return RestrictionMap.decode(layout.width, layout.height, await response.text());
    } catch (error) {
      console.error(`Could not load restrictions for ${layout.id}; placement is unrestricted.`, error);
      return RestrictionMap.open(layout.width, layout.height);
    }
  }

  private defaultBuildings(layout: LayoutInfo): Patch {
    return addDefaultBuildings(this.doc, layout);
  }

  /** Makes the loaded document the open plan, with fresh history. */
  private startPlan(id: string, name: string, saveNow: boolean): void {
    this.planIdState.set(id);
    this.planName.set(name);
    this.localPlans.currentId = id;
    this.undoStack = [];
    this.redoStack = [];
    this.historyState.set({ undo: 0, redo: 0 });
    this.revisionState.update((r) => r + 1);
    for (const listener of this.listeners) listener.reset();
    this.saveState.set('empty');
    if (saveNow) this.flushAutosave(true);
  }

  private changed(patch: Patch): void {
    this.historyState.set({ undo: this.undoStack.length, redo: this.redoStack.length });
    this.revisionState.update((r) => r + 1);
    for (const listener of this.listeners) listener.patched(patch);
    this.scheduleAutosave();
  }

  private pruneSelection(): void {
    this.selection.update((uids) => uids.filter((uid) => this.doc.object(uid)));
  }

  private scheduleAutosave(): void {
    if (!this.browser) return;
    this.saveState.set('saving');
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.flushAutosave(), AUTOSAVE_DELAY);
  }

  /** Writes the open plan now if a save is pending (or `force` is set). */
  private flushAutosave(force = false): void {
    if (!this.browser || (!force && this.autosaveTimer === undefined)) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = undefined;
    const id = this.planIdState();
    const ok = this.localPlans.write(id, this.snapshot(), this.planName(), Date.now());
    if (ok) this.localPlans.currentId = id;
    this.saveState.set(ok ? 'saved' : 'error');
    this.savedPlans.set(this.localPlans.list());
  }

  private readStoredOptions(): Partial<PlannerOptions> {
    if (!this.browser) return {};
    try {
      const raw = localStorage.getItem(OPTIONS_KEY);
      const stored: unknown = raw ? JSON.parse(raw) : null;
      return typeof stored === 'object' && stored !== null ? (stored as Partial<PlannerOptions>) : {};
    } catch {
      return {};
    }
  }
}

function browserStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
