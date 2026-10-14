import { CatalogItem, Restriction, findItem, spriteOverhang } from '../data/catalog';
import { ObjectChange, Patch, PlacedObject, PlanDocument, TileChange, cellKey, emptyPatch, footprint, parseKey } from './plan-document';
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

/** Why something can't go somewhere, for telling the user. */
export type BlockReason =
  | { kind: 'outside' }
  /** The map's ground doesn't allow it: water and cliffs ('accessible'), or unbuildable or untillable ground. */
  | { kind: 'ground'; restriction: Restriction }
  /** An object or ground tile is in the way. */
  | { kind: 'object' | 'tile'; itemId: string }
  /** The tile in front of a building's door must be buildable or a path. */
  | { kind: 'door' }
  /** A building's extra placement tiles (the greenhouse's doorstep, the farmhouse's mailbox) aren't free. */
  | { kind: 'clearance' };

/** Which item of a placement didn't fit, and why. */
export interface PlacementFailure {
  itemId: string;
  reason: BlockReason;
}

export interface PlacementCheck {
  ok: boolean;
  /** Tiles that block the placement, for highlighting. */
  blocked: [number, number][];
  /** Why the first blocked tile is blocked. */
  reason?: BlockReason;
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

/**
 * Whether a ground tile may go under a standing object: floors under anything but a building, and
 * crops under giant crops. (Sprinklers replace crops when placed, but nothing grows under one.)
 */
function objectAllowsTile(obj: CatalogItem | undefined, tile: CatalogItem): boolean {
  if (!obj) return true;
  if (obj.category === 'buildings') return false;
  return tile.category === 'paths' || (obj.category === 'crops' && tile.category === 'crops');
}

const tileItem = (doc: PlanDocument, x: number, y: number) => {
  const id = doc.tileAt(x, y);
  return id ? findItem(id) : undefined;
};

/** The object other than those being moved that stands on a tile, if any. */
function occupant(doc: PlanDocument, x: number, y: number, ignore: ReadonlySet<number>): PlacedObject | null {
  const obj = doc.objectAt(x, y);
  return obj && !ignore.has(obj.uid) ? obj : null;
}

/** Why the map's ground keeps an item with the given restriction off a tile, if it does. */
function groundReason(map: RestrictionMap, x: number, y: number, restriction: Restriction): BlockReason | null {
  if (!map.inBounds(x, y)) return { kind: 'outside' };
  // Water and cliffs keep everything off, whatever the item needs.
  if (map.isBlocked(x, y, 'accessible')) return { kind: 'ground', restriction: 'accessible' };
  return map.isBlocked(x, y, restriction) ? { kind: 'ground', restriction } : null;
}

/** Why a tile can't hold part of an object (wrong ground, something else there, a ground tile it can't cover), if it can't. */
function misfit(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, x: number, y: number, ignore: ReadonlySet<number>): BlockReason | null {
  const ground = groundReason(map, x, y, item.restriction);
  if (ground) return ground;
  const obj = occupant(doc, x, y, ignore);
  if (obj) return { kind: 'object', itemId: obj.itemId };
  const tile = tileItem(doc, x, y);
  return tileAllowsObject(tile, item) ? null : { kind: 'tile', itemId: tile!.id };
}

/** Whether people could walk over a tile: passable ground with nothing solid on it. */
function passable(doc: PlanDocument, map: RestrictionMap, x: number, y: number, ignore: ReadonlySet<number>): boolean {
  const tile = tileItem(doc, x, y);
  return !map.isBlocked(x, y, 'accessible') && !occupant(doc, x, y, ignore) && (!tile || walkable(tile));
}

/** Whether a tile is a path in the game's sense: a floor, grass or soil to walk on, with nothing on it. */
function onPath(doc: PlanDocument, map: RestrictionMap, x: number, y: number, ignore: ReadonlySet<number>): boolean {
  const tile = tileItem(doc, x, y);
  return map.inBounds(x, y) && tile !== undefined && walkable(tile) && !occupant(doc, x, y, ignore);
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
  let reason: BlockReason | undefined;
  const block = (tx: number, ty: number, why: BlockReason) => {
    blocked.set(cellKey(tx, ty), [tx, ty]);
    reason ??= why;
  };
  const standing = (tx: number, ty: number) => from !== undefined && inFootprint(from, findItem(from.itemId), tx, ty);
  for (const [tx, ty] of footprint({ x, y }, item)) {
    const why = !map.inBounds(tx, ty) ? { kind: 'outside' as const } : options.anywhere || standing(tx, ty) ? null : misfit(doc, map, item, tx, ty, ignore);
    if (why) block(tx, ty, why);
  }
  const rules = item.building;
  if (rules && !options.anywhere) {
    for (const area of rules.placementTiles ?? []) {
      for (const [tx, ty] of footprint({ x: x + area.x, y: y + area.y }, area)) {
        const free = area.passableOnly ? passable(doc, map, tx, ty, ignore) : !misfit(doc, map, item, tx, ty, ignore);
        if (!free) block(tx, ty, { kind: 'clearance' });
      }
    }
    if (rules.door) {
      const tx = x + rules.door.x;
      const ty = y + rules.door.y + 1;
      const own = inFootprint({ x, y }, item, tx, ty) || standing(tx, ty);
      if (!own && misfit(doc, map, item, tx, ty, ignore) && !onPath(doc, map, tx, ty, ignore)) block(tx, ty, { kind: 'door' });
    }
  }
  return { ok: blocked.size === 0, blocked: [...blocked.values()], reason };
}

function inFootprint(obj: { x: number; y: number }, item: { width: number; height: number } | undefined, x: number, y: number): boolean {
  return x >= obj.x && y >= obj.y && x < obj.x + (item?.width ?? 1) && y < obj.y + (item?.height ?? 1);
}

function canPaintTile(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, x: number, y: number, options: PlacementOptions): boolean {
  return paintMisfit(doc, map, item, x, y, options) === null;
}

/** Why a ground tile can't be painted on a cell, if it can't. */
export function paintMisfit(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, x: number, y: number, options: PlacementOptions): BlockReason | null {
  if (!map.inBounds(x, y)) return { kind: 'outside' };
  if (options.anywhere) return null;
  const ground = groundReason(map, x, y, item.restriction);
  if (ground) return ground;
  const obj = doc.objectAt(x, y);
  return obj && !objectAllowsTile(findItem(obj.itemId), item) ? { kind: 'object', itemId: obj.itemId } : null;
}

/** Where to paint or erase: a rectangle, or any cells (a freehand stroke's). */
export type Area = TileRect | Iterable<[number, number]>;

/** The cells of an area; a rectangle's row by row. */
export function cellsOf(area: Area): Iterable<[number, number]> {
  return Symbol.iterator in area ? area : footprint(area, area);
}

/** The cells around a rectangle's edge, clockwise from its top-left. */
export function outlineCells(rect: TileRect): [number, number][] {
  const { x, y, width, height } = rect;
  if (width <= 2 || height <= 2) return [...footprint(rect, rect)];
  const cells: [number, number][] = [];
  for (let i = 0; i < width; i++) cells.push([x + i, y]);
  for (let i = 1; i < height; i++) cells.push([x + width - 1, y + i]);
  for (let i = width - 2; i >= 0; i--) cells.push([x + i, y + height - 1]);
  for (let i = height - 2; i >= 1; i--) cells.push([x, y + i]);
  return cells;
}

/**
 * Which lines of a rectangle a Rows fill takes: along its longer side, two lines then a one-tile
 * walkway, so every tile is next to a walkway (trellis crops can't be walked through).
 */
function rowLines(rect: TileRect, lineSize: number): { across: boolean; starts: number[] } {
  const across = rect.width >= rect.height;
  const length = across ? rect.height : rect.width;
  const starts: number[] = [];
  for (let at = 0, inPair = 0; at + lineSize <= length; ) {
    starts.push(at);
    at += lineSize;
    if (++inPair === 2) {
      at += 1;
      inPair = 0;
    }
  }
  return { across, starts };
}

/** The cells a Rows fill paints: pairs of rows along the rectangle's longer side, with walkways between. */
export function rowCells(rect: TileRect): [number, number][] {
  const { across, starts } = rowLines(rect, 1);
  const cells: [number, number][] = [];
  for (const start of starts) {
    if (across) for (let x = rect.x; x < rect.x + rect.width; x++) cells.push([x, rect.y + start]);
    else for (let y = rect.y; y < rect.y + rect.height; y++) cells.push([rect.x + start, y]);
  }
  return cells;
}

/** Where a Rows fill puts copies of an object: lines of them in pairs, with walkways between. */
export function rowPositions(item: CatalogItem, rect: TileRect): { x: number; y: number }[] {
  const { across, starts } = rowLines(rect, rect.width >= rect.height ? item.height : item.width);
  const positions: { x: number; y: number }[] = [];
  for (const start of starts) {
    if (across) for (let x = rect.x; x + item.width <= rect.x + rect.width; x += item.width) positions.push({ x, y: rect.y + start });
    else for (let y = rect.y; y + item.height <= rect.y + rect.height; y += item.height) positions.push({ x: rect.x + start, y });
  }
  return positions;
}

/** Where copies of an item go around a rectangle's edge: stepping by its footprint along each side. */
export function outlinePositions(item: CatalogItem, rect: TileRect): { x: number; y: number }[] {
  if (item.width === 1 && item.height === 1) return outlineCells(rect).map(([x, y]) => ({ x, y }));
  const right = rect.x + rect.width - item.width;
  const bottom = rect.y + rect.height - item.height;
  const positions: { x: number; y: number }[] = [];
  for (let x = rect.x; x <= right; x += item.width) positions.push({ x, y: rect.y }, { x, y: bottom });
  for (let y = rect.y + item.height; y < bottom; y += item.height) positions.push({ x: rect.x, y }, { x: right, y });
  return positions;
}

/**
 * The cells a straight line between two cells passes through, end to end and without gaps
 * (Bresenham's line), so a fast freehand stroke doesn't skip tiles.
 */
export function lineCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const cells: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (let x = x0, y = y0; ; ) {
    cells.push([x, y]);
    if (x === x1 && y === y1) return cells;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/** Cells in an area that the given item can't be painted on. */
export function blockedTiles(
  doc: PlanDocument,
  map: RestrictionMap,
  item: CatalogItem,
  area: Area,
  options: PlacementOptions,
): [number, number][] {
  return [...cellsOf(area)].filter(([x, y]) => !canPaintTile(doc, map, item, x, y, options));
}

/** Paints a ground tile on each cell it can go on: a rectangle's, or a freehand stroke's. */
export function paintTiles(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, area: Area, options: PlacementOptions): Patch {
  const patch = emptyPatch();
  const painted = new Set<string>();
  for (const [x, y] of cellsOf(area)) {
    const before = doc.tileAt(x, y);
    if (painted.has(cellKey(x, y)) || before === item.id || (before && !options.overwrite)) continue;
    if (!canPaintTile(doc, map, item, x, y, options)) continue;
    painted.add(cellKey(x, y));
    patch.tiles.push({ x, y, before, after: item.id });
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
  return placeEach(doc, map, item, objectPositions(item, rect), options);
}

/** Places a copy of an object at each position where it fits, clear of earlier copies (as along a freehand stroke). */
export function placeEach(
  doc: PlanDocument,
  map: RestrictionMap,
  item: CatalogItem,
  positions: Iterable<{ x: number; y: number }>,
  options: PlacementOptions,
): Patch {
  // Copies go onto a scratch document first, so later ones see the earlier ones.
  const scratch = doc.clone();
  const patch = emptyPatch();
  for (const { x, y } of positions) {
    if (!checkObject(scratch, map, item, x, y, options).ok) continue;
    const placed: PlacedObject = { uid: scratch.allocateUid(), itemId: item.id, x, y };
    const landing: Patch = { tiles: [], objects: [{ uid: placed.uid, before: null, after: placed }] };
    clearGround(scratch, item, x, y, landing);
    scratch.apply(landing);
    patch.tiles.push(...landing.tiles);
    patch.objects.push(...landing.objects);
  }
  return patch;
}

/** Removes every tile on the cells and every object touching them: a rectangle's, or a freehand stroke's. */
export function erase(doc: PlanDocument, area: Area): Patch {
  const patch = emptyPatch();
  const erased = new Set<string>();
  const objects = new Set<number>();
  for (const [x, y] of cellsOf(area)) {
    const before = doc.tileAt(x, y);
    if (before && !erased.has(cellKey(x, y))) patch.tiles.push({ x, y, before, after: null });
    erased.add(cellKey(x, y));
    const obj = doc.objectAt(x, y);
    if (obj && !objects.has(obj.uid)) patch.objects.push({ uid: obj.uid, before: obj, after: null });
    if (obj) objects.add(obj.uid);
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
    if (!map.inBounds(x, y) || (!options.anywhere && misfit(doc, map, item, x, y, ignore))) return null;
  }
  const patch: Patch = { tiles: [], objects: [{ uid, before: obj, after: { ...obj, itemId: item.id } }] };
  clearGround(doc, item, obj.x, obj.y, patch);
  return patch;
}

/** Ground tiles and objects put down together: a selection being moved, or copies being pasted. */
export interface Group {
  tiles: readonly { x: number; y: number; itemId: string }[];
  objects: readonly PlacedObject[];
}

/** A group's edit, or (when it doesn't fit) an empty patch, the tiles in the way and why. */
export interface GroupPlacement {
  patch: Patch;
  blocked: [number, number][];
  failure?: PlacementFailure;
}

/**
 * Puts a group of tiles and objects down shifted by (dx, dy), as one edit that fits whole or not at
 * all. A `moving` group is what's on the map now: it is lifted first, so it may land partly where it
 * was, and its objects keep their ids. Otherwise the group is new copies. `map` should leave out
 * moving objects' own effects on the ground (PlannerStore.restrictionsIgnoring).
 */
export function putGroup(
  doc: PlanDocument,
  map: RestrictionMap,
  group: Group,
  dx: number,
  dy: number,
  options: PlacementOptions,
  moving: boolean,
): GroupPlacement {
  // Edits are tried on a copy, then compared with the document to make the patch.
  const scratch = doc.clone();
  if (moving) {
    scratch.apply({
      tiles: group.tiles.map((t) => ({ x: t.x, y: t.y, before: t.itemId, after: null })),
      objects: group.objects.map((obj) => ({ uid: obj.uid, before: obj, after: null })),
    });
  }
  const touched = new Set(moving ? group.tiles.map((t) => cellKey(t.x, t.y)) : []);
  const blocked = new Map<string, [number, number]>();
  let failure: PlacementFailure | undefined;
  const objects: ObjectChange[] = [];
  // Ground first, so objects are checked against the ground they'll stand on.
  for (const tile of group.tiles) {
    const item = findItem(tile.itemId);
    if (!item) continue;
    const x = tile.x + dx;
    const y = tile.y + dy;
    const there = scratch.tileAt(x, y);
    const why = paintMisfit(scratch, map, item, x, y, options) ?? (there !== null && there !== item.id && !options.overwrite ? { kind: 'tile' as const, itemId: there } : null);
    if (why) {
      blocked.set(cellKey(x, y), [x, y]);
      failure ??= { itemId: item.id, reason: why };
      continue;
    }
    scratch.apply({ tiles: [{ x, y, before: there, after: item.id }], objects: [] });
    touched.add(cellKey(x, y));
  }
  for (const obj of group.objects) {
    const item = findItem(obj.itemId);
    if (!item) continue;
    const x = obj.x + dx;
    const y = obj.y + dy;
    const check = checkObject(scratch, map, item, x, y, options, new Set(), moving ? obj : undefined);
    if (!check.ok) {
      for (const [bx, by] of check.blocked) blocked.set(cellKey(bx, by), [bx, by]);
      if (check.reason) failure ??= { itemId: item.id, reason: check.reason };
      continue;
    }
    const placed: PlacedObject = { uid: moving ? obj.uid : scratch.allocateUid(), itemId: item.id, x, y };
    const landing: Patch = { tiles: [], objects: [{ uid: placed.uid, before: null, after: placed }] };
    clearGround(scratch, item, x, y, landing);
    for (const t of landing.tiles) touched.add(cellKey(t.x, t.y));
    scratch.apply(landing);
    objects.push({ uid: placed.uid, before: moving ? obj : null, after: placed });
  }
  if (blocked.size) return { patch: emptyPatch(), blocked: [...blocked.values()], failure };
  const tiles: TileChange[] = [];
  for (const cell of touched) {
    const [x, y] = parseKey(cell);
    const before = doc.tileAt(x, y);
    const after = scratch.tileAt(x, y);
    if (before !== after) tiles.push({ x, y, before, after });
  }
  return { patch: { tiles, objects }, blocked: [] };
}

/** Moves objects by an offset, as {@link putGroup} does. Returns null when any of them can't land. */
export function moveObjects(
  doc: PlanDocument,
  map: RestrictionMap,
  uids: readonly number[],
  dx: number,
  dy: number,
  options: PlacementOptions,
): Patch | null {
  const objects = uids.flatMap((uid) => doc.object(uid) ?? []);
  const { patch, blocked } = putGroup(doc, map, { tiles: [], objects }, dx, dy, options, true);
  return blocked.length ? null : patch;
}
