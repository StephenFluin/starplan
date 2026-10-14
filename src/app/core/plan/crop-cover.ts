import { CatalogItem, RangeShape, findItem } from '../data/catalog';
import { PlanDocument, parseKey } from './plan-document';
import { PlacementOptions, checkObject } from './placement';
import { rangeTiles } from './range';
import { RestrictionMap } from './restriction-map';

export interface CropCoverPlan {
  /** Where to put the new items. */
  positions: { x: number; y: number }[];
  /** How many of them take the place of a crop. */
  onCrops: number;
  /** Crop tiles none can reach. */
  unreachable: number;
}

/** Greedy restarts to try, and how many of the best to try merging pairs in (see planCropCover). */
const RESTARTS = 24;
const MERGED = 6;

/**
 * Ground that needs watering and guarding from crows: crops and the tilled soil and trellises they
 * grow on (not tea bushes).
 */
function needsCover(itemId: string): boolean {
  const item = findItem(itemId);
  return item?.category === 'crops' && item.kind === 'tile' && item.id !== 'tea';
}

/** A spot an item could go: its tile index, the crops it would cover (by index) and whether it's on one. */
interface Spot {
  cell: number;
  covers: Int32Array;
  onCrop: boolean;
}

/**
 * Picks where to add range items of a kind (scarecrows, or sprinklers) so that every crop on the
 * farm is in range of one, using as few as it can. Items of the same group already placed count
 * (rarecrows as scarecrows, any sprinkler as a sprinkler).
 *
 * Finding the true minimum is a set-cover problem, so it's a greedy pass (the spot covering the
 * most uncovered crops, again and again), then dropping items the others make redundant and
 * merging pairs that one spot can replace. Early choices decide the rest, so the greedy pass starts
 * from several spots (the biggest, and a spread of those reaching the hardest crop to reach: the
 * best layout often splits a field rather than taking its middle) and the best result wins. Like
 * players do, it puts them inside fields when that means fewer of them (each takes one crop's
 * place), and on free ground when that's as good.
 */
export function planCropCover(doc: PlanDocument, map: RestrictionMap, item: CatalogItem, options: PlacementOptions): CropCoverPlan {
  const range = item.range;
  const none = { positions: [], onCrops: 0, unreachable: 0 };
  if (!range) return none;
  const width = doc.width;
  const size = doc.width * doc.height;
  const index = (x: number, y: number) => (x >= 0 && y >= 0 && x < doc.width && y < doc.height ? y * width + x : -1);

  // Crops not yet in range of an item of the same group.
  const target = new Uint8Array(size);
  for (const [key, itemId] of doc.allTiles()) {
    const i = index(...parseKey(key));
    if (i >= 0 && needsCover(itemId)) target[i] = 1;
  }
  for (const obj of doc.allObjects()) {
    const objRange = findItem(obj.itemId)?.range;
    if (objRange?.group !== range.group) continue;
    for (const [x, y] of rangeTiles(objRange, obj.x, obj.y)) {
      const i = index(x, y);
      if (i >= 0) target[i] = 0;
    }
  }
  return planCover(doc, map, item, options, target);
}

/**
 * Picks where to add range items of a kind so that every target tile (a mask over the document's
 * tiles) is in range of one, using as few as it can (see {@link planCropCover} for how). `allowed`
 * can rule spots out, beyond where the item can't go anyway.
 */
export function planCover(
  doc: PlanDocument,
  map: RestrictionMap,
  item: CatalogItem,
  options: PlacementOptions,
  target: Uint8Array,
  allowed: (x: number, y: number) => boolean = () => true,
): CropCoverPlan {
  const range = item.range;
  const none = { positions: [], onCrops: 0, unreachable: 0 };
  if (!range) return none;
  const width = doc.width;
  const size = doc.width * doc.height;
  const index = (x: number, y: number) => (x >= 0 && y >= 0 && x < doc.width && y < doc.height ? y * width + x : -1);
  const crop = new Uint8Array(size);
  for (const [key, itemId] of doc.allTiles()) {
    const i = index(...parseKey(key));
    if (i >= 0 && findItem(itemId)?.category === 'crops') crop[i] = 1;
  }
  const targets: number[] = [];
  for (let i = 0; i < size; i++) if (target[i]) targets.push(i);
  if (!targets.length) return none;

  // Every spot reaching a crop that needs covering, with what it would cover.
  const offsets = rangeTiles(range, 0, 0);
  const spots: Spot[] = [];
  const seen = new Uint8Array(size);
  for (const t of targets) {
    const tx = t % width;
    const ty = (t - tx) / width;
    for (const [dx, dy] of [[0, 0] as const, ...offsets]) {
      const x = tx - dx;
      const y = ty - dy;
      const i = index(x, y);
      if (i < 0 || seen[i]) continue;
      seen[i] = 1;
      if (!allowed(x, y) || !checkObject(doc, map, item, x, y, options).ok) continue;
      const covers: number[] = target[i] ? [i] : [];
      for (const [ox, oy] of offsets) {
        const j = index(x + ox, y + oy);
        if (j >= 0 && target[j]) covers.push(j);
      }
      // A spot on a crop, or on a tile it's meant to cover, takes a tile from the field.
      spots.push({ cell: i, covers: Int32Array.from(covers), onCrop: crop[i] === 1 || target[i] === 1 });
    }
  }

  const spotsByCell = new Map<number, number[]>();
  spots.forEach((spot, s) => spot.covers.forEach((c) => (spotsByCell.get(c) ?? spotsByCell.set(c, []).get(c)!).push(s)));
  // Every layout has a scarecrow reaching the hardest crop to reach (usually a field's corner), so
  // start from a spread of those spots, plus the biggest spots overall.
  const bySize = (list: readonly number[]) => [...list].sort((a, b) => spots[b].covers.length - spots[a].covers.length);
  let hardest: number[] = [];
  for (const reach of spotsByCell.values()) if (!hardest.length || reach.length < hardest.length) hardest = reach;
  const reaching = bySize(hardest);
  const stride = Math.max(1, Math.floor(reaching.length / RESTARTS));
  const starts = [...new Set([...bySize(spots.map((_, s) => s)).slice(0, 4), ...reaching.filter((_, i) => i % stride === 0).slice(0, RESTARTS)])];
  const cost = (plan: number[]) => plan.length * 1000 + plan.filter((s) => spots[s].onCrop).length;

  // Greedy and prune from every start, and from each alignment of a perfect tiling (square and
  // plus-shaped sprinkler ranges tile a field exactly); then merge pairs in the most promising few.
  const tilings = lattices(range).map((onLattice) => spots.flatMap((spot, s) => (onLattice(spot.cell % width, Math.floor(spot.cell / width)) ? [s] : [])));
  const plans = [...starts.map((start) => [start]), ...tilings].map((initial) => {
    const plan = coverGreedily(spots, target, initial);
    prune(spots, plan, coverCounts(spots, plan, size));
    return plan;
  });
  plans.sort((a, b) => cost(a) - cost(b));
  for (const plan of plans.slice(0, MERGED)) mergePairs(spots, plan, coverCounts(spots, plan, size), spotsByCell);
  const chosen = plans.reduce<number[] | null>((best, plan) => (!best || cost(plan) < cost(best) ? plan : best), null) ?? [];
  const covered = coverCounts(spots, chosen, size);
  return {
    positions: chosen.map((s) => ({ x: spots[s].cell % width, y: Math.floor(spots[s].cell / width) })),
    onCrops: chosen.filter((s) => spots[s].onCrop).length,
    unreachable: targets.filter((t) => !covered[t]).length,
  };
}

/**
 * Starting from some spots, repeatedly picks the spot covering the most still-uncovered targets,
 * free ground winning ties. Lazy: a spot's count only ever drops, so a spot whose recounted value
 * still beats every other's last one is the best.
 */
function coverGreedily(spots: readonly Spot[], target: Uint8Array, initial: readonly number[]): number[] {
  const left = target.slice();
  const picked: number[] = [];
  const pick = (s: number) => {
    picked.push(s);
    for (const c of spots[s].covers) left[c] = 0;
  };
  for (const s of initial) pick(s);
  // Higher counts first; on equal counts, free ground first.
  const score = (s: number, count: number) => count * 2 + (spots[s].onCrop ? 0 : 1);
  const queue = new MaxHeap();
  spots.forEach((spot, s) => queue.push(s, score(s, spot.covers.length)));
  while (queue.size) {
    const s = queue.pop();
    let count = 0;
    for (const c of spots[s].covers) count += left[c];
    if (!count) continue;
    const fresh = score(s, count);
    if (!queue.size || fresh >= queue.topScore) pick(s);
    else queue.push(s, fresh);
  }
  return picked;
}

/** A binary max-heap of items (numbers) by score. */
class MaxHeap {
  private readonly items: number[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.items.length;
  }

  get topScore(): number {
    return this.scores[0];
  }

  push(item: number, score: number): void {
    let i = this.items.length;
    this.items.push(item);
    this.scores.push(score);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.scores[parent] >= score) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastScore = this.scores.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.scores[0] = lastScore;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let largest = i;
        if (l < this.items.length && this.scores[l] > this.scores[largest]) largest = l;
        if (r < this.items.length && this.scores[r] > this.scores[largest]) largest = r;
        if (largest === i) break;
        this.swap(i, largest);
        i = largest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.scores[a], this.scores[b]] = [this.scores[b], this.scores[a]];
  }
}

/**
 * The alignments of a range's perfect tiling, as tests of whether a tile is on it: square ranges
 * tile on a (2r+1) grid, the plus-shaped basic sprinkler on the (x + 2y) mod 5 lattice, and other
 * shapes (scarecrows' circles) have none.
 */
function lattices(range: RangeShape): ((x: number, y: number) => boolean)[] {
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  if (range.shape === 'square') {
    const step = range.radius * 2 + 1;
    return Array.from({ length: step * step }, (_, i) => (x: number, y: number) => mod(x - (i % step), step) === 0 && mod(y - Math.floor(i / step), step) === 0);
  }
  if (range.shape === 'diamond' && range.radius === 1) return Array.from({ length: 5 }, (_, k) => (x: number, y: number) => mod(x + 2 * y - k, 5) === 0);
  return [];
}

/** How many of the chosen spots cover each tile. */
function coverCounts(spots: readonly Spot[], plan: readonly number[], size: number): Int32Array {
  const counts = new Int32Array(size);
  for (const s of plan) for (const c of spots[s].covers) counts[c]++;
  return counts;
}

/** Drops scarecrows whose crops the others all cover, trying those covering least first. */
function prune(spots: readonly Spot[], plan: number[], counts: Int32Array): void {
  for (const s of [...plan].sort((a, b) => spots[a].covers.length - spots[b].covers.length)) {
    if (!spots[s].covers.every((c) => counts[c] > 1)) continue;
    plan.splice(plan.indexOf(s), 1);
    for (const c of spots[s].covers) counts[c]--;
  }
}

/** Replaces any two scarecrows with one spot that covers everything only they cover. */
function mergePairs(spots: readonly Spot[], plan: number[], counts: Int32Array, spotsByCell: ReadonlyMap<number, number[]>): void {
  // How many of the pair cover each tile, and which tiles a replacement must cover.
  const pairCount = new Int32Array(counts.length);
  const needed = new Uint8Array(counts.length);
  for (let merged = true; merged; ) {
    merged = false;
    pairs: for (let i = 0; i < plan.length; i++) {
      for (let j = i + 1; j < plan.length; j++) {
        const [a, b] = [plan[i], plan[j]];
        for (const s of [a, b]) for (const c of spots[s].covers) pairCount[c]++;
        // Crops only this pair covers.
        const need: number[] = [];
        for (const s of [a, b]) {
          for (const c of spots[s].covers) {
            if (counts[c] === pairCount[c] && !needed[c]) {
              needed[c] = 1;
              need.push(c);
            }
          }
        }
        for (const s of [a, b]) for (const c of spots[s].covers) pairCount[c] = 0;
        let replacement = -1;
        for (const s of need.length ? (spotsByCell.get(need[0]) ?? []) : []) {
          if (plan.includes(s)) continue;
          let hits = 0;
          for (const c of spots[s].covers) hits += needed[c];
          if (hits === need.length) {
            replacement = s;
            break;
          }
        }
        for (const c of need) needed[c] = 0;
        if (replacement >= 0) {
          const s = replacement;
          for (const old of [a, b]) for (const c of spots[old].covers) counts[c]--;
          for (const c of spots[s].covers) counts[c]++;
          plan.splice(j, 1);
          plan.splice(i, 1, s);
          merged = true;
          break pairs;
        }
      }
    }
  }
}
