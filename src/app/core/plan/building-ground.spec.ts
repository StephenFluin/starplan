import { PlanDocument } from './plan-document';
import { restrictionsWithBuildings } from './building-ground';
import { IMPASSABLE, NOT_BUILDABLE, NOT_TILLABLE, RestrictionMap } from './restriction-map';

describe('restrictionsWithBuildings', () => {
  const add = (doc: PlanDocument, uid: number, itemId: string, x: number, y: number) =>
    doc.apply({ tiles: [], objects: [{ uid, before: null, after: { uid, itemId, x, y } }] });

  // GreenhouseBuilding.doesTileHaveProperty: the greenhouse is at (5, 5), 7x6.
  it('makes the ground around the greenhouse buildable but untillable, and its doorstep unbuildable', () => {
    const doc = new PlanDocument(20, 20);
    add(doc, 1, 'greenhouse', 5, 5);
    const unbuildable = RestrictionMap.decode(20, 20, '400c').withTiles([[4, 6, IMPASSABLE | NOT_BUILDABLE | NOT_TILLABLE]]);
    const map = restrictionsWithBuildings(unbuildable, doc);
    // One column to the left, the row below, and most of the row below that.
    for (const [x, y] of [[4, 5], [4, 11], [11, 11], [6, 12], [10, 12]]) {
      expect(map.bits(x, y), `${x},${y}`).toBe(NOT_TILLABLE);
    }
    // The 3x2 doorstep.
    for (const [x, y] of [[7, 11], [9, 12]]) expect(map.bits(x, y), `${x},${y}`).toBe(NOT_BUILDABLE | NOT_TILLABLE);
    // Beyond it, and impassable ground, are as they were.
    for (const [x, y] of [[12, 5], [5, 12], [11, 12], [7, 13], [4, 6]]) {
      expect(map.bits(x, y), `${x},${y}`).toBe(unbuildable.bits(x, y));
    }
  });

  it('leaves out buildings being moved', () => {
    const doc = new PlanDocument(20, 20);
    add(doc, 1, 'greenhouse', 5, 5);
    const ground = RestrictionMap.open(20, 20);
    expect(restrictionsWithBuildings(ground, doc, new Set([1]))).toBe(ground);
  });

  it("makes the farmhouse's mailbox solid", () => {
    const doc = new PlanDocument(20, 20);
    add(doc, 1, 'house', 0, 0);
    const map = restrictionsWithBuildings(RestrictionMap.open(20, 20), doc);
    expect(map.isBlocked(9, 4, 'accessible')).toBe(true);
    expect(map.isBlocked(9, 5, 'accessible')).toBe(false);
  });
});
