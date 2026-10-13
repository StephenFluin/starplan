import { CatalogItem, findItem } from '../data/catalog';

export interface PlacedObject {
  uid: number;
  itemId: string;
  /** Top-left tile. */
  x: number;
  y: number;
}

export interface TileChange {
  x: number;
  y: number;
  before: string | null;
  after: string | null;
}

export interface ObjectChange {
  uid: number;
  before: PlacedObject | null;
  after: PlacedObject | null;
}

/** A reversible set of edits. Undo applies it inverted. */
export interface Patch {
  tiles: TileChange[];
  objects: ObjectChange[];
  /** Set by the edit that first moves the greenhouse off its start location (see PlanDocument.greenhouseMoved). */
  greenhouseMoved?: { before: boolean; after: boolean };
}

export function emptyPatch(): Patch {
  return { tiles: [], objects: [] };
}

export function isEmptyPatch(patch: Patch): boolean {
  return patch.tiles.length === 0 && patch.objects.length === 0;
}

export function invertPatch(patch: Patch): Patch {
  return {
    tiles: patch.tiles.map((t) => ({ x: t.x, y: t.y, before: t.after, after: t.before })).reverse(),
    objects: patch.objects.map((o) => ({ uid: o.uid, before: o.after, after: o.before })).reverse(),
    ...(patch.greenhouseMoved && { greenhouseMoved: { before: patch.greenhouseMoved.after, after: patch.greenhouseMoved.before } }),
  };
}

const key = (x: number, y: number) => `${x},${y}`;

/**
 * The mutable contents of a plan: one ground tile per cell plus objects with footprints.
 * All edits go through {@link apply} so they can be recorded and undone.
 */
export class PlanDocument {
  private readonly tiles = new Map<string, string>();
  private readonly objects = new Map<number, PlacedObject>();
  /** cell key -> uid of the object covering it. */
  private readonly occupancy = new Map<string, number>();
  private nextUid = 1;
  /**
   * Whether the greenhouse has ever left its start location. As in the game, the grass under its
   * start location is cleared for good from then on (LayoutInfo.greenhouseDirt).
   */
  greenhouseMoved = false;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  allocateUid(): number {
    return this.nextUid++;
  }

  tileAt(x: number, y: number): string | null {
    return this.tiles.get(key(x, y)) ?? null;
  }

  objectAt(x: number, y: number): PlacedObject | null {
    const uid = this.occupancy.get(key(x, y));
    return uid === undefined ? null : (this.objects.get(uid) ?? null);
  }

  object(uid: number): PlacedObject | null {
    return this.objects.get(uid) ?? null;
  }

  allTiles(): IterableIterator<[string, string]> {
    return this.tiles.entries();
  }

  allObjects(): IterableIterator<PlacedObject> {
    return this.objects.values();
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  get objectCount(): number {
    return this.objects.size;
  }

  /** Objects whose footprint intersects the given tile rectangle. */
  objectsInRect(x: number, y: number, width: number, height: number): PlacedObject[] {
    const found = new Set<number>();
    for (let ty = y; ty < y + height; ty++) {
      for (let tx = x; tx < x + width; tx++) {
        const uid = this.occupancy.get(key(tx, ty));
        if (uid !== undefined) found.add(uid);
      }
    }
    return [...found].map((uid) => this.objects.get(uid)!);
  }

  apply(patch: Patch): void {
    for (const change of patch.tiles) {
      if (change.after === null) {
        this.tiles.delete(key(change.x, change.y));
      } else {
        this.tiles.set(key(change.x, change.y), change.after);
      }
    }
    // Remove everything first so objects that swap or shift onto each other's tiles land cleanly.
    for (const change of patch.objects) {
      if (change.before) this.removeObject(change.before.uid);
    }
    for (const change of patch.objects) {
      if (change.after) this.addObject(change.after);
    }
    if (patch.greenhouseMoved) this.greenhouseMoved = patch.greenhouseMoved.after;
  }

  clear(): void {
    this.tiles.clear();
    this.objects.clear();
    this.occupancy.clear();
    this.greenhouseMoved = false;
  }

  private addObject(obj: PlacedObject): void {
    const item = findItem(obj.itemId);
    this.objects.set(obj.uid, { ...obj });
    this.nextUid = Math.max(this.nextUid, obj.uid + 1);
    for (const [x, y] of footprint(obj, item)) {
      this.occupancy.set(key(x, y), obj.uid);
    }
  }

  private removeObject(uid: number): void {
    const obj = this.objects.get(uid);
    if (!obj) return;
    for (const [x, y] of footprint(obj, findItem(obj.itemId))) {
      if (this.occupancy.get(key(x, y)) === uid) this.occupancy.delete(key(x, y));
    }
    this.objects.delete(uid);
  }
}

export function* footprint(obj: { x: number; y: number }, item: CatalogItem | undefined): Generator<[number, number]> {
  const width = item?.width ?? 1;
  const height = item?.height ?? 1;
  for (let y = obj.y; y < obj.y + height; y++) {
    for (let x = obj.x; x < obj.x + width; x++) {
      yield [x, y];
    }
  }
}

export function parseKey(cell: string): [number, number] {
  const [x, y] = cell.split(',');
  return [Number(x), Number(y)];
}
