import { CatalogItem, findItem, spriteOverhang } from '../data/catalog';
import { Patch, PlacedObject, PlanDocument, emptyPatch, footprint } from './plan-document';
import { RestrictionMap } from './restriction-map';

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacementOptions {
  /** Skip restriction and overlap checks entirely. */
  anywhere: boolean;
  /** Replace existing ground tiles when painting. */
  overwrite: boolean;
}

export interface PlacementCheck {
  ok: boolean;
  /** Tiles that block the placement, for highlighting. */
  blocked: [number, number][];
}

/** The object drawn at a tile: its footprint, or a roof hanging above a footprint. */
export function objectAtVisual(doc: PlanDocument, x: number, y: number): PlacedObject | null {
  const hit = doc.objectAt(x, y);
  if (hit) return hit;
  for (const obj of doc.allObjects()) {
    const item = findItem(obj.itemId);
    const overhang = item ? spriteOverhang(item) : 0;
    if (item && overhang && x >= obj.x && x < obj.x + item.width && y >= obj.y - overhang && y < obj.y) return obj;
  }
  return null;
}

/** Rectangle spanning two corner tiles, inclusive. */
export function rectFromCorners(ax: number, ay: number, bx: number, by: number): TileRect {
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, width: Math.abs(ax - bx) + 1, height: Math.abs(ay - by) + 1 };
}

/** Sprinklers and scarecrows can go straight onto planted ground, replacing the crop there. */
export function replacesCrops(obj: CatalogItem): boolean {
  return obj.range?.group === 'sprinkler' || obj.range?.group === 'scarecrow';
}

/** Crops that grow up a trellis, which nobody can walk through. */
const TRELLIS_CROPS = new Set(['green-bean', 'hops', 'grape']);

/**
 * Whether people can walk over a ground tile: floors, grass, and tilled soil unless a trellis or tea
 * bush stands there. Fences, debris and markers are solid.
 */
export function walkable(tile: CatalogItem): boolean {
  if (tile.category === 'paths' || tile.id === 'grass') return true;
  return tile.category === 'crops' && tile.id !== 'trellis' && tile.id !== 'tea' && !TRELLIS_CROPS.has(tile.id);
}

/**
 * What happens to a ground tile when a building goes over it, as in GameLocation.buildStructure:
 * floors stay underneath (except under a Well), grass and empty tilled soil are cleared, and
 * anything else (crops, fences, debris) is in the way.
 */
export function groundUnderBuilding(tile: CatalogItem, building: CatalogItem): 'keep' | 'clear' | 'block' {
  if (tile.category === 'paths') return building.building?.floorsUnderneath === false ? 'clear' : 'keep';
  return tile.id === 'grass' || tile.id === 'farmland' ? 'clear' : 'block';
}

/** Whether an object may sit on top of a ground tile (possibly replacing it). */
export function tileAllowsObject(tile: CatalogItem | undefined, obj: CatalogItem): boolean {
  if (!tile) return true;
  if (obj.category === 'buildings') return groundUnderBuilding(tile, obj) !== 'block';
  if (tile.category === 'paths') return true;
  if (tile.category === 'crops' && replacesCrops(obj)) return true;
  // Giant crops grow out of tilled soil and crops.
  return obj.category === 'crops' && tile.category === 'crops';
}

/** Whether a ground tile may go underneath a standing object. Nothing goes under a building. */
function objectAllowsTile(obj: CatalogItem | undefined, tile: CatalogItem): boolean {
  return !obj || (obj.category !== 'buildings' && tileAllowsObject(tile, obj));
}

const tileItem = (doc: PlanDocument, x: number, y: number) => {
  const id = doc.tileAt(x, y);
  return id ? findItem(id) : undefined;
};

/** Whether an object other than those being moved stands on a tile. */
function occupied(doc: PlanDocument, x: number, y: number, ignore: ReadonlySet<number>): boolean {
  const occupant = doc.objectAt(x, y);
  return occupant !== null && !ignore.has(occupant.uid);
}

/** Whether a tile can hold part of an object: allowed ground, nothing else there, and a ground tile it may cover. */
function fits(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, x: number, y: number, ignore: ReadonlySet<number>): boolean {
  return !map.isBlocked(x, y, item.restriction) && !occupied(doc, x, y, ignore) && tileAllowsObject(tileItem(doc, x, y), item);
}

/** Whether people could walk over a tile: passable ground with nothing solid on it. */
function passable(doc: PlanDocument, map: RestrictionMap, x: number, y: number, ignore: ReadonlySet<number>): boolean {
  const tile = tileItem(doc, x, y);
  return !map.isBlocked(x, y, 'accessible') && !occupied(doc, x, y, ignore) && (!tile || walkable(tile));
}

/** Whether a tile is a path in the game's sense: a floor, grass or soil to walk on, with nothing on it. */
function onPath(doc: PlanDocument, map: RestrictionMap, x: number, y: number, ignore: ReadonlySet<number>): boolean {
  const tile = tileItem(doc, x, y);
  return map.inBounds(x, y) && tile !== undefined && walkable(tile) && !occupied(doc, x, y, ignore);
}

/**
 * Whether an object fits at a position: its footprint in bounds, on ground its restriction allows
 * and clear of other objects. A building, as in the game, also needs its extra placement tiles free
 * and the tile in front of its door buildable or a path.
 *
 * `ignore` lists objects being moved, which don't get in the way. `from` is where the object stands
 * now when it is being moved or swapped: like the game, it may keep standing on those tiles.
 */
export function checkObject(
  doc: PlanDocument,
  map: RestrictionMap,
  item: CatalogItem,
  x: number,
  y: number,
  options: PlacementOptions,
  ignore: ReadonlySet<number> = new Set(),
  from?: PlacedObject,
): PlacementCheck {
  const blocked = new Map<string, [number, number]>();
  const block = (tx: number, ty: number) => blocked.set(`${tx},${ty}`, [tx, ty]);
  const standing = (tx: number, ty: number) => from !== undefined && inFootprint(from, findItem(from.itemId), tx, ty);
  for (const [tx, ty] of footprint({ x, y }, item)) {
    if (!map.inBounds(tx, ty) || (!options.anywhere && !standing(tx, ty) && !fits(doc, map, item, tx, ty, ignore))) block(tx, ty);
  }
  const rules = item.building;
  if (rules && !options.anywhere) {
    for (const area of rules.placementTiles ?? []) {
      for (const [tx, ty] of footprint({ x: x + area.x, y: y + area.y }, area)) {
        const free = area.passableOnly ? passable(doc, map, tx, ty, ignore) : fits(doc, map, item, tx, ty, ignore);
        if (!free) block(tx, ty);
      }
    }
    if (rules.door) {
      const tx = x + rules.door.x;
      const ty = y + rules.door.y + 1;
      const own = inFootprint({ x, y }, item, tx, ty) || standing(tx, ty);
      if (!own && !fits(doc, map, item, tx, ty, ignore) && !onPath(doc, map, tx, ty, ignore)) block(tx, ty);
    }
  }
  return { ok: blocked.size === 0, blocked: [...blocked.values()] };
}

function inFootprint(obj: { x: number; y: number }, item: { width: number; height: number } | undefined, x: number, y: number): boolean {
  return x >= obj.x && y >= obj.y && x < obj.x + (item?.width ?? 1) && y < obj.y + (item?.height ?? 1);
}

function canPaintTile(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, x: number, y: number, options: PlacementOptions): boolean {
  if (!map.inBounds(x, y)) return false;
  if (options.anywhere) return true;
  if (map.isBlocked(x, y, item.restriction)) return false;
  const occupant = doc.objectAt(x, y);
  return objectAllowsTile(occupant ? findItem(occupant.itemId) : undefined, item);
}

/** Tiles in the rectangle that the given item can't be painted on. */
export function blockedTiles(
  doc: PlanDocument,
  map: RestrictionMap,
  item: CatalogItem,
  rect: TileRect,
  options: PlacementOptions,
): [number, number][] {
  const blocked: [number, number][] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (!canPaintTile(doc, map, item, x, y, options)) blocked.push([x, y]);
    }
  }
  return blocked;
}

export function paintTiles(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, rect: TileRect, options: PlacementOptions): Patch {
  const patch = emptyPatch();
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const before = doc.tileAt(x, y);
      if (before === item.id || (before && !options.overwrite)) continue;
      if (!canPaintTile(doc, map, item, x, y, options)) continue;
      patch.tiles.push({ x, y, before, after: item.id });
    }
  }
  return patch;
}

/**
 * Adds tile removals for the ground an object clears where it lands: crops under sprinklers and
 * scarecrows; grass, tilled soil and (under a Well) floors under buildings.
 */
function clearGround(doc: PlanDocument, item: CatalogItem, x: number, y: number, patch: Patch): void {
  const building = item.category === 'buildings';
  if (!building && !replacesCrops(item)) return;
  for (const [tx, ty] of footprint({ x, y }, item)) {
    const before = doc.tileAt(tx, ty);
    const tile = before ? findItem(before) : undefined;
    if (!before || !tile) continue;
    const clears = building ? groundUnderBuilding(tile, item) === 'clear' : tile.category === 'crops';
    if (clears && !patch.tiles.some((t) => t.x === tx && t.y === ty)) patch.tiles.push({ x: tx, y: ty, before, after: null });
  }
}

/** Places one object at each position, which must already be valid (e.g. from a coverage layout). */
export function placeAt(doc: PlanDocument, item: CatalogItem, positions: readonly { x: number; y: number }[]): Patch {
  const patch = emptyPatch();
  for (const { x, y } of positions) {
    const placed: PlacedObject = { uid: doc.allocateUid(), itemId: item.id, x, y };
    patch.objects.push({ uid: placed.uid, before: null, after: placed });
    clearGround(doc, item, x, y, patch);
  }
  return patch;
}

/** Where {@link placeObjects} puts copies of an item to fill a rectangle: stepping by its footprint, so they never overlap. */
export function objectPositions(item: CatalogItem, rect: TileRect): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  const stepsX = Math.max(1, Math.floor(rect.width / item.width));
  const stepsY = Math.max(1, Math.floor(rect.height / item.height));
  for (let sy = 0; sy < stepsY; sy++) {
    for (let sx = 0; sx < stepsX; sx++) positions.push({ x: rect.x + sx * item.width, y: rect.y + sy * item.height });
  }
  return positions;
}

/** Places copies of an object across the rectangle where they fit. A click is a 1x1 rectangle, which places one. */
export function placeObjects(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, rect: TileRect, options: PlacementOptions): Patch {
  const patch = emptyPatch();
  for (const { x, y } of objectPositions(item, rect)) {
    if (!checkObject(doc, map, item, x, y, options).ok) continue;
    const placed: PlacedObject = { uid: doc.allocateUid(), itemId: item.id, x, y };
    patch.objects.push({ uid: placed.uid, before: null, after: placed });
    clearGround(doc, item, x, y, patch);
  }
  return patch;
}

/** Removes every tile and object touching the rectangle. */
export function erase(doc: PlanDocument, rect: TileRect): Patch {
  const patch = emptyPatch();
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const before = doc.tileAt(x, y);
      if (before) patch.tiles.push({ x, y, before, after: null });
    }
  }
  for (const obj of doc.objectsInRect(rect.x, rect.y, rect.width, rect.height)) {
    patch.objects.push({ uid: obj.uid, before: obj, after: null });
  }
  return patch;
}

/**
 * Swaps a placed object for another item in place. Returns null when the new item doesn't fit.
 * Like an upgrade in the game, it only needs room for any tiles a bigger footprint adds. `map`
 * should leave out the object's own effect on the ground (PlannerStore.restrictionsIgnoring).
 */
export function swapObject(
  doc: PlanDocument,
  map: RestrictionMap,
  uid: number,
  item: CatalogItem,
  options: PlacementOptions,
): Patch | null {
  const obj = doc.object(uid);
  if (!obj || obj.itemId === item.id) return null;
  const current = findItem(obj.itemId);
  const ignore = new Set([uid]);
  for (const [x, y] of footprint(obj, item)) {
    if (inFootprint(obj, current, x, y)) continue;
    if (!map.inBounds(x, y) || (!options.anywhere && !fits(doc, map, item, x, y, ignore))) return null;
  }
  const patch: Patch = { tiles: [], objects: [{ uid, before: obj, after: { ...obj, itemId: item.id } }] };
  clearGround(doc, item, obj.x, obj.y, patch);
  return patch;
}

/**
 * Moves a group of objects by an offset. Returns null when any of them can't land. `map` should
 * leave out the moving objects' own effects on the ground (PlannerStore.restrictionsIgnoring).
 */
export function moveObjects(
  doc: PlanDocument,
  map: RestrictionMap,
  uids: readonly number[],
  dx: number,
  dy: number,
  options: PlacementOptions,
): Patch | null {
  const patch = emptyPatch();
  const ignore = new Set(uids);
  for (const uid of uids) {
    const obj = doc.object(uid);
    const item = obj && findItem(obj.itemId);
    if (!obj || !item) continue;
    if (!checkObject(doc, map, item, obj.x + dx, obj.y + dy, options, ignore, obj).ok) return null;
    patch.objects.push({ uid, before: obj, after: { ...obj, x: obj.x + dx, y: obj.y + dy } });
    clearGround(doc, item, obj.x + dx, obj.y + dy, patch);
  }
  return patch;
}
