import { isSavedPlan, SavedPlan } from './plan/serialize';

export interface LocalPlanInfo {
  id: string;
  name: string;
  layout: string;
  /** Milliseconds since the epoch. */
  updatedAt: number;
}

const INDEX_KEY = 'starplan:plans';
const CURRENT_KEY = 'starplan:current';
const PLAN_PREFIX = 'starplan:plan:';
/** Single-slot autosave used before the plan library existed. */
const LEGACY_AUTOSAVE_KEY = 'starplan:autosave';

/**
 * Plans saved in this browser's localStorage. Every access is guarded: storage can be full,
 * disabled or cleared at any time, and saving is best-effort.
 */
export class LocalPlans {
  constructor(private readonly storage: Storage | null) {}

  list(): LocalPlanInfo[] {
    const index = this.readJson(INDEX_KEY);
    if (!Array.isArray(index)) return [];
    return index
      .filter((entry): entry is LocalPlanInfo => typeof entry?.id === 'string' && typeof entry?.name === 'string')
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  read(id: string): SavedPlan | null {
    const plan = this.readJson(PLAN_PREFIX + id);
    return isSavedPlan(plan) ? plan : null;
  }

  /** Writes a plan, adding it to the index if new. Returns false if storage refused it. */
  write(id: string, plan: SavedPlan, name: string, now: number): boolean {
    if (!this.set(PLAN_PREFIX + id, JSON.stringify(plan))) return false;
    const others = this.list().filter((entry) => entry.id !== id);
    return this.set(INDEX_KEY, JSON.stringify([{ id, name, layout: plan.layout, updatedAt: now }, ...others]));
  }

  rename(id: string, name: string): void {
    const index = this.list().map((entry) => (entry.id === id ? { ...entry, name } : entry));
    this.set(INDEX_KEY, JSON.stringify(index));
  }

  remove(id: string): void {
    this.set(INDEX_KEY, JSON.stringify(this.list().filter((entry) => entry.id !== id)));
    try {
      this.storage?.removeItem(PLAN_PREFIX + id);
    } catch {
      // Ignore: the index no longer references it.
    }
  }

  get currentId(): string | null {
    try {
      return this.storage?.getItem(CURRENT_KEY) ?? null;
    } catch {
      return null;
    }
  }

  set currentId(id: string | null) {
    if (id) this.set(CURRENT_KEY, id);
  }

  /** Moves the old single autosave slot into the library, once. Returns its new id. */
  migrateLegacyAutosave(id: string, name: string, now: number): string | null {
    const legacy = this.readJson(LEGACY_AUTOSAVE_KEY);
    if (!isSavedPlan(legacy) || !this.write(id, legacy, name, now)) return null;
    try {
      this.storage?.removeItem(LEGACY_AUTOSAVE_KEY);
    } catch {
      // The copy succeeded; a leftover legacy slot is harmless.
    }
    return id;
  }

  private readJson(key: string): unknown {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private set(key: string, value: string): boolean {
    try {
      this.storage?.setItem(key, value);
      return Boolean(this.storage);
    } catch {
      return false;
    }
  }
}

export function newPlanId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
