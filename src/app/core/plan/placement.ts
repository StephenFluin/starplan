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

/** Whether an object may sit on top of a ground tile (possibly replacing it). */
export function tileAllowsObject(tile: CatalogItem | undefined, obj: CatalogItem): boolean {
  if (!tile) return true;
  if (obj.category === 'buildings') return false;
  if (tile.category === 'paths') return true;
  if (tile.category === 'crops' && replacesCrops(obj)) return true;
  // Giant crops grow out of tilled soil and crops.
  return obj.category === 'crops' && tile.category === 'crops';
}

/** Whether a ground tile may go underneath an object. */
function objectAllowsTile(obj: CatalogItem | undefined, tile: CatalogItem): boolean {
  return !obj || tileAllowsObject(tile, obj);
}

export function checkObject(
  doc: PlanDocument,
  map: RestrictionMap,
  item: CatalogItem,
  x: number,
  y: number,
  options: PlacementOptions,
  ignore: ReadonlySet<number> = new Set(),
): PlacementCheck {
  const blocked: [number, number][] = [];
  for (const [tx, ty] of footprint({ x, y }, item)) {
    if (!map.inBounds(tx, ty)) {
      blocked.push([tx, ty]);
      continue;
    }
    if (options.anywhere) continue;
    const occupant = doc.objectAt(tx, ty);
    const tile = doc.tileAt(tx, ty);
    if (
      map.isBlocked(tx, ty, item.restriction) ||
      (occupant && !ignore.has(occupant.uid)) ||
      !tileAllowsObject(tile ? findItem(tile) : undefined, item)
    ) {
      blocked.push([tx, ty]);
    }
  }
  return { ok: blocked.length === 0, blocked };
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

/** Adds tile removals for crops an object is about to replace. */
function clearReplacedCrops(doc: PlanDocument, item: CatalogItem, x: number, y: number, patch: Patch): void {
  if (!replacesCrops(item)) return;
  for (const [tx, ty] of footprint({ x, y }, item)) {
    const before = doc.tileAt(tx, ty);
    if (before && findItem(before)?.category === 'crops' && !patch.tiles.some((t) => t.x === tx && t.y === ty)) {
      patch.tiles.push({ x: tx, y: ty, before, after: null });
    }
  }
}

/** Places one object at each position, which must already be valid (e.g. from a coverage layout). */
export function placeAt(doc: PlanDocument, item: CatalogItem, positions: readonly { x: number; y: number }[]): Patch {
  const patch = emptyPatch();
  for (const { x, y } of positions) {
    const placed: PlacedObject = { uid: doc.allocateUid(), itemId: item.id, x, y };
    patch.objects.push({ uid: placed.uid, before: null, after: placed });
    clearReplacedCrops(doc, item, x, y, patch);
  }
  return patch;
}

/**
 * Places copies of an object across the rectangle, stepping by its footprint.
 * A single click is just a 1x1 rectangle, which places one object.
 */
export function placeObjects(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, rect: TileRect, options: PlacementOptions): Patch {
  const patch = emptyPatch();
  const stepsX = Math.max(1, Math.floor(rect.width / item.width));
  const stepsY = Math.max(1, Math.floor(rect.height / item.height));
  // Copies step by the footprint, so they never overlap each other.
  for (let sy = 0; sy < stepsY; sy++) {
    for (let sx = 0; sx < stepsX; sx++) {
      const x = rect.x + sx * item.width;
      const y = rect.y + sy * item.height;
      if (!checkObject(doc, map, item, x, y, options).ok) continue;
      const placed: PlacedObject = { uid: doc.allocateUid(), itemId: item.id, x, y };
      patch.objects.push({ uid: placed.uid, before: null, after: placed });
      clearReplacedCrops(doc, item, x, y, patch);
    }
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

/** Swaps a placed object for another item in place. Returns null when the new item doesn't fit. */
export function swapObject(
  doc: PlanDocument,
  map: RestrictionMap,
  uid: number,
  item: CatalogItem,
  options: PlacementOptions,
): Patch | null {
  const obj = doc.object(uid);
  if (!obj || obj.itemId === item.id) return null;
  // Tiles the object already stands on stay valid (default buildings often sit on tiles the
  // restriction data marks unbuildable); only tiles a larger footprint adds are checked.
  const current = new Set([...footprint(obj, findItem(obj.itemId))].map(([x, y]) => `${x},${y}`));
  const { blocked } = checkObject(doc, map, item, obj.x, obj.y, options, new Set([uid]));
  if (blocked.some(([x, y]) => !current.has(`${x},${y}`))) return null;
  const patch: Patch = { tiles: [], objects: [{ uid, before: obj, after: { ...obj, itemId: item.id } }] };
  clearReplacedCrops(doc, item, obj.x, obj.y, patch);
  return patch;
}

/** Moves a group of objects by an offset. Returns null when any of them can't land. */
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
    if (!checkObject(doc, map, item, obj.x + dx, obj.y + dy, options, ignore).ok) return null;
    patch.objects.push({ uid, before: obj, after: { ...obj, x: obj.x + dx, y: obj.y + dy } });
    clearReplacedCrops(doc, item, obj.x + dx, obj.y + dy, patch);
  }
  return patch;
}
