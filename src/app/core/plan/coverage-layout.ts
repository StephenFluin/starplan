import { CatalogItem, RangeGroup, RangeShape, findItem } from '../data/catalog';
import { PlanDocument } from './plan-document';
import { PlacementOptions, TileRect, checkObject } from './placement';
import { rangeTiles } from './range';
import { RestrictionMap } from './restriction-map';

export interface TilePosition {
  x: number;
  y: number;
}

/** Range groups whose items are laid out for coverage when dragged, instead of filling every tile. */
const COVERAGE_GROUPS: readonly RangeGroup[] = ['sprinkler', 'scarecrow'];

/** Whether dragging this item should lay out an efficient grid instead of filling every tile. */
export function usesCoverageLayout(item: CatalogItem): boolean {
  return item.range !== undefined && COVERAGE_GROUPS.includes(item.range.group);
}

/**
 * Chooses where to put range items (sprinklers, scarecrows) so that every plantable tile in the
 * drawn area is in range of one (or holds one).
 *
 * Items may go outside the area, as long as they still reach into it. Layouts are ranked by:
 * 1. the fewest items, then
 * 2. the fewest items inside the area (each one there takes a tile from the crops), then
 * 3. the fewest items off the layout's grid, so rows and columns line up.
 *
 * Tiles that can't be tilled, tiles under other objects and tiles already covered by existing
 * items of the same kind are skipped. Outside the area, items never replace crops.
 *
 * For each alignment of the ideal tiling of the range's shape (square and plus-shaped sprinklers
 * have one; scarecrow circles rely on the greedy pass), the tiling is laid down inside the area,
 * leftover tiles are patched greedily (inside or outside), redundant items dropped, and items moved
 * outside the area wherever that keeps everything covered. The best of these results wins.
 */
export function coverageLayout(
  doc: PlanDocument,
  map: RestrictionMap,
  item: CatalogItem,
  rect: TileRect,
  options: PlacementOptions,
): TilePosition[] {
  const range = item.range;
  if (!range || rect.width <= 0 || rect.height <= 0) return [];

  const offsets = rangeTiles(range, 0, 0);
  const reach = Math.max(...offsets.map(([dx, dy]) => Math.max(Math.abs(dx), Math.abs(dy))));
  const field = new CoverageField(rect, reach, offsets, gridKey(range));
  markNeeds(field, doc, map, rect, options, range.group);

  const placeable = new Map<number, boolean>();
  const canPlace = (x: number, y: number) => {
    const i = field.areaIndex(x, y);
    let ok = placeable.get(i);
    if (ok === undefined) {
      ok = checkObject(doc, map, item, x, y, options).ok;
      // Outside the drawn area, don't destroy crops the user didn't ask to cover.
      if (ok && !field.inTarget(x, y)) {
        const tile = doc.tileAt(x, y);
        ok = !tile || findItem(tile)?.category !== 'crops';
      }
      placeable.set(i, ok);
    }
    return ok;
  };

  // Rank finished layouts: moving items outward changes how many end up inside the area.
  let best: TilePosition[] | null = null;
  for (const onLattice of lattices(range, rect)) {
    const solution = field.shiftOutward(field.solve(onLattice, canPlace), canPlace);
    if (!best || field.isBetter(solution, best)) best = solution;
  }
  return best ?? [];
}

/** Marks which tiles in the drawn area still need covering. */
function markNeeds(
  field: CoverageField,
  doc: PlanDocument,
  map: RestrictionMap,
  rect: TileRect,
  options: PlacementOptions,
  group: RangeGroup,
): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const plantable = options.anywhere ? map.inBounds(x, y) : !map.isBlocked(x, y, 'tillable');
      if (plantable && !doc.objectAt(x, y)) field.needs[field.targetIndex(x, y)] = 1;
    }
  }
  // Existing items of the same kind near the area already cover some of it.
  // 16 is the largest radius in the catalog (deluxe scarecrow).
  const reach = 16;
  for (const obj of doc.objectsInRect(rect.x - reach, rect.y - reach, rect.width + reach * 2, rect.height + reach * 2)) {
    const range = findItem(obj.itemId)?.range;
    if (range?.group !== group) continue;
    for (const [x, y] of rangeTiles(range, obj.x, obj.y)) {
      if (field.inTarget(x, y)) field.needs[field.targetIndex(x, y)] = 0;
    }
  }
}

/**
 * Candidate tilings: predicates selecting where a "perfect" packing would put items.
 * Square ranges tile on a (2r+1) grid; the plus-shaped basic sprinkler tiles on the
 * (x + 2y) mod 5 lattice. Other shapes fall back to the greedy pass alone.
 */
function* lattices(range: RangeShape, rect: TileRect): Generator<(x: number, y: number) => boolean> {
  if (range.shape === 'square') {
    const step = range.radius * 2 + 1;
    for (let oy = 0; oy < step; oy++) {
      for (let ox = 0; ox < step; ox++) {
        yield (x, y) => mod(x - rect.x - ox, step) === 0 && mod(y - rect.y - oy, step) === 0;
      }
    }
  } else if (range.shape === 'diamond' && range.radius === 1) {
    for (let k = 0; k < 5; k++) {
      yield (x, y) => mod(x - rect.x + 2 * (y - rect.y) - k, 5) === 0;
    }
  } else {
    yield () => false;
  }
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * Which tiling class a spot belongs to: items in a tidy layout all share one. Square ranges repeat
 * every 2r+1 tiles in both directions; the plus-shaped sprinkler along (x + 2y) mod 5.
 */
function gridKey(range: RangeShape): (at: TilePosition) => string {
  if (range.shape === 'square') {
    const step = range.radius * 2 + 1;
    return (at) => `${mod(at.x, step)},${mod(at.y, step)}`;
  }
  if (range.shape === 'diamond' && range.radius === 1) return (at) => `${mod(at.x + 2 * at.y, 5)}`;
  return () => '';
}

/** Coverage bookkeeping for one candidate layout. */
interface LayoutState {
  placed: TilePosition[];
  /** Per drawn-area tile: how many items cover it. */
  cover: Uint16Array;
  /** Per candidate tile (drawn area plus margin): whether an item sits there. */
  occupied: Uint8Array;
}

/**
 * The drawn area ("target") whose tiles need covering, and the larger candidate area around it
 * (the target plus a margin of the range's reach) where items may go.
 */
class CoverageField {
  readonly needs: Uint8Array;
  private readonly area: TileRect;

  constructor(
    private readonly target: TileRect,
    reach: number,
    /** Tiles covered relative to the item's own tile. */
    private readonly offsets: [number, number][],
    private readonly gridKey: (at: TilePosition) => string,
  ) {
    this.needs = new Uint8Array(target.width * target.height);
    this.area = { x: target.x - reach, y: target.y - reach, width: target.width + reach * 2, height: target.height + reach * 2 };
  }

  inTarget(x: number, y: number): boolean {
    return within(this.target, x, y);
  }

  targetIndex(x: number, y: number): number {
    return (y - this.target.y) * this.target.width + (x - this.target.x);
  }

  areaIndex(x: number, y: number): number {
    return (y - this.area.y) * this.area.width + (x - this.area.x);
  }

  /** Fewer items wins; on a tie, fewer items inside the drawn area, then fewer off the grid. */
  isBetter(a: readonly TilePosition[], b: readonly TilePosition[]): boolean {
    if (a.length !== b.length) return a.length < b.length;
    const inside = this.insideCount(a) - this.insideCount(b);
    if (inside !== 0) return inside < 0;
    return this.offGridCount(a) < this.offGridCount(b);
  }

  /** Lattice placements, then greedy patching of anything left uncovered, then pruning. */
  solve(onLattice: (x: number, y: number) => boolean, canPlace: (x: number, y: number) => boolean): TilePosition[] {
    const state = this.emptyState();
    const { target } = this;

    // The tiling only goes inside the drawn area: a tiling point just outside it can reach as
    // little as one tile (plus-shaped sprinklers). Outside spots come from the patching below.
    for (let y = target.y; y < target.y + target.height; y++) {
      for (let x = target.x; x < target.x + target.width; x++) {
        if (onLattice(x, y) && canPlace(x, y) && this.gain(state, x, y) > 0) this.place(state, x, y);
      }
    }

    // Patch remaining uncovered tiles with whichever placement covers the most of them,
    // preferring spots outside the drawn area on a tie.
    for (let y = target.y; y < target.y + target.height; y++) {
      for (let x = target.x; x < target.x + target.width; x++) {
        if (this.satisfied(state, x, y)) continue;
        let bestAt: TilePosition | null = null;
        let bestScore = 0;
        for (const [cx, cy] of this.candidatesFor(x, y)) {
          if (state.occupied[this.areaIndex(cx, cy)] || !canPlace(cx, cy)) continue;
          const g = this.gain(state, cx, cy);
          const score = g * 2 + (this.inTarget(cx, cy) ? 0 : 1);
          if (g > 0 && score > bestScore) {
            bestScore = score;
            bestAt = { x: cx, y: cy };
          }
        }
        // A tile nothing can reach is left uncovered rather than blocking the layout.
        if (bestAt) this.place(state, bestAt.x, bestAt.y);
      }
    }

    // Drop items whose tiles are all covered by others.
    for (let n = state.placed.length - 1; n >= 0; n--) {
      const at = state.placed[n];
      if (this.isRedundant(state, at)) this.remove(state, n);
    }
    return state.placed;
  }

  /** Moves items from inside the drawn area to outside it wherever coverage stays complete. */
  shiftOutward(layout: readonly TilePosition[], canPlace: (x: number, y: number) => boolean): TilePosition[] {
    const state = this.emptyState();
    for (const at of layout) this.place(state, at.x, at.y);

    for (let n = 0; n < state.placed.length; n++) {
      const from = state.placed[n];
      if (!this.inTarget(from.x, from.y)) continue;
      // Take it out, then look for an outside spot that covers everything left uncovered.
      this.remove(state, n);
      const uncovered = this.uncoveredTiles(state);
      const to = this.outsideSpotCovering(state, uncovered, from, canPlace) ?? from;
      this.place(state, to.x, to.y);
      // place() appends; move it back to this index so the loop visits every item once.
      state.placed.splice(n, 0, state.placed.pop()!);
    }
    return state.placed;
  }

  private outsideSpotCovering(
    state: LayoutState,
    uncovered: readonly TilePosition[],
    near: TilePosition,
    canPlace: (x: number, y: number) => boolean,
  ): TilePosition | null {
    if (uncovered.length === 0) return null;
    const covers = new Set(this.offsets.map(([dx, dy]) => `${dx},${dy}`));
    let best: TilePosition | null = null;
    let bestDistance = Infinity;
    // Any spot covering the first uncovered tile is within reach of it.
    for (const [cx, cy] of this.candidatesFor(uncovered[0].x, uncovered[0].y)) {
      if (this.inTarget(cx, cy) || state.occupied[this.areaIndex(cx, cy)] || !canPlace(cx, cy)) continue;
      if (!uncovered.every((t) => covers.has(`${t.x - cx},${t.y - cy}`))) continue;
      const distance = Math.abs(cx - near.x) + Math.abs(cy - near.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: cx, y: cy };
      }
    }
    return best;
  }

  private uncoveredTiles(state: LayoutState): TilePosition[] {
    const tiles: TilePosition[] = [];
    const { target } = this;
    for (let y = target.y; y < target.y + target.height; y++) {
      for (let x = target.x; x < target.x + target.width; x++) {
        if (!this.satisfied(state, x, y)) tiles.push({ x, y });
      }
    }
    return tiles;
  }

  /** Candidate spots covering (or standing on) a tile, within the candidate area. */
  private candidatesFor(x: number, y: number): [number, number][] {
    const spots: [number, number][] = [[x, y], ...this.offsets.map(([dx, dy]): [number, number] => [x - dx, y - dy])];
    return spots.filter(([cx, cy]) => within(this.area, cx, cy));
  }

  private emptyState(): LayoutState {
    return {
      placed: [],
      cover: new Uint16Array(this.needs.length),
      occupied: new Uint8Array(this.area.width * this.area.height),
    };
  }

  private satisfied(state: LayoutState, x: number, y: number): boolean {
    const i = this.targetIndex(x, y);
    return !this.needs[i] || state.cover[i] > 0 || state.occupied[this.areaIndex(x, y)] === 1;
  }

  private gain(state: LayoutState, x: number, y: number): number {
    let total = this.inTarget(x, y) && !this.satisfied(state, x, y) ? 1 : 0;
    this.forEachCovered(x, y, (tx, ty) => {
      if (!this.satisfied(state, tx, ty)) total++;
    });
    return total;
  }

  private isRedundant(state: LayoutState, at: TilePosition): boolean {
    if (this.inTarget(at.x, at.y)) {
      const own = this.targetIndex(at.x, at.y);
      if (this.needs[own] && state.cover[own] === 0) return false;
    }
    let redundant = true;
    this.forEachCovered(at.x, at.y, (tx, ty) => {
      const i = this.targetIndex(tx, ty);
      if (this.needs[i] && !state.occupied[this.areaIndex(tx, ty)] && state.cover[i] < 2) redundant = false;
    });
    return redundant;
  }

  private place(state: LayoutState, x: number, y: number): void {
    state.placed.push({ x, y });
    state.occupied[this.areaIndex(x, y)] = 1;
    this.forEachCovered(x, y, (tx, ty) => state.cover[this.targetIndex(tx, ty)]++);
  }

  private remove(state: LayoutState, n: number): void {
    const [{ x, y }] = state.placed.splice(n, 1);
    state.occupied[this.areaIndex(x, y)] = 0;
    this.forEachCovered(x, y, (tx, ty) => state.cover[this.targetIndex(tx, ty)]--);
  }

  private insideCount(layout: readonly TilePosition[]): number {
    return layout.filter((at) => this.inTarget(at.x, at.y)).length;
  }

  /** Items outside the layout's most common tiling class. */
  private offGridCount(layout: readonly TilePosition[]): number {
    const counts = new Map<string, number>();
    for (const at of layout) {
      const key = this.gridKey(at);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return layout.length - Math.max(0, ...counts.values());
  }

  /** Calls fn for each drawn-area tile an item at (x, y) covers. */
  private forEachCovered(x: number, y: number, fn: (x: number, y: number) => void): void {
    for (const [dx, dy] of this.offsets) {
      if (this.inTarget(x + dx, y + dy)) fn(x + dx, y + dy);
    }
  }
}

function within(rect: TileRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}
