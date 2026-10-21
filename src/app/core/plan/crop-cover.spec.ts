import { findItem } from '../data/catalog';
import { planCropCover } from './crop-cover';
import { PlanDocument, cellKey } from './plan-document';
import { PlacementOptions, paintTiles, placeAt } from './placement';
import { rangeTiles } from './range';
import { RestrictionMap } from './restriction-map';

const options: PlacementOptions = { anywhere: false, overwrite: true };
const scarecrow = findItem('scarecrow')!;

/** Crop tiles no item of a group reaches. */
function uncovered(doc: PlanDocument, group = 'scarecrow'): string[] {
  const covered = new Set<string>();
  for (const obj of doc.allObjects()) {
    const range = findItem(obj.itemId)?.range;
    if (range?.group === group)
      for (const [x, y] of rangeTiles(range, obj.x, obj.y)) covered.add(cellKey(x, y));
  }
  return [...doc.allTiles()].map(([cell]) => cell).filter((cell) => !covered.has(cell));
}

describe('planCropCover', () => {
  let doc: PlanDocument;
  let map: RestrictionMap;

  beforeEach(() => {
    doc = new PlanDocument(60, 60);
    map = RestrictionMap.open(60, 60);
  });

  it('covers every crop with few scarecrows', () => {
    doc.apply(
      paintTiles(doc, map, findItem('parsnip')!, { x: 10, y: 10, width: 30, height: 30 }, options),
    );
    const plan = planCropCover(doc, map, scarecrow, options);
    // Covering it from outside would take nine; inside, six or seven.
    expect(plan.positions.length).toBeLessThanOrEqual(7);
    expect(plan.unreachable).toBe(0);
    doc.apply(placeAt(doc, scarecrow, plan.positions));
    expect(uncovered(doc)).toEqual([]);
  });

  it('counts scarecrows already there, and adds none when every crop is covered', () => {
    doc.apply(
      paintTiles(doc, map, findItem('parsnip')!, { x: 10, y: 10, width: 5, height: 5 }, options),
    );
    doc.apply(placeAt(doc, findItem('rarecrow-1')!, [{ x: 16, y: 12 }]));
    expect(planCropCover(doc, map, scarecrow, options).positions).toEqual([]);
  });

  it('puts scarecrows on free ground when that does as well', () => {
    // A thin row of crops: a scarecrow just beside it covers it as well as one in it.
    doc.apply(
      paintTiles(doc, map, findItem('parsnip')!, { x: 10, y: 10, width: 9, height: 1 }, options),
    );
    const plan = planCropCover(doc, map, scarecrow, options);
    expect(plan.positions).toHaveLength(1);
    expect(plan.onCrops).toBe(0);
  });

  it('takes a crop’s place when there’s no free ground', () => {
    // A field filling the whole map: there's no free ground.
    const small = new PlanDocument(20, 20);
    const open = RestrictionMap.open(20, 20);
    small.apply(
      paintTiles(small, open, findItem('parsnip')!, { x: 0, y: 0, width: 20, height: 20 }, options),
    );
    const plan = planCropCover(small, open, scarecrow, options);
    expect(plan.onCrops).toBe(plan.positions.length);
    small.apply(placeAt(small, scarecrow, plan.positions));
    expect(uncovered(small)).toEqual([]);
  });

  it('uses fewer deluxe scarecrows', () => {
    doc.apply(
      paintTiles(doc, map, findItem('parsnip')!, { x: 5, y: 5, width: 30, height: 30 }, options),
    );
    const plan = planCropCover(doc, map, findItem('deluxe-scarecrow')!, options);
    // Two, each covering half the field.
    expect(plan.positions.length).toBe(2);
  });

  it('waters every crop with sprinklers, on a tidy grid', () => {
    // Quality sprinklers water the 3x3 around them: one in the middle of each 3x3 block.
    doc.apply(
      paintTiles(doc, map, findItem('parsnip')!, { x: 10, y: 10, width: 12, height: 12 }, options),
    );
    const sprinkler = findItem('q-sprinkler')!;
    const plan = planCropCover(doc, map, sprinkler, options);
    expect(plan.positions).toHaveLength(16);
    doc.apply(placeAt(doc, sprinkler, plan.positions));
    expect(uncovered(doc, 'sprinkler')).toEqual([]);
  });
});
