import { findItem } from '../data/catalog';
import { PlanDocument, invertPatch } from './plan-document';
import { PlacementOptions, checkObject, erase, moveObjects, paintTiles, placeObjects, rectFromCorners } from './placement';
import { NOT_BUILDABLE, RestrictionMap } from './restriction-map';

const item = (id: string) => {
  const found = findItem(id);
  if (!found) throw new Error(`Unknown item ${id}`);
  return found;
};

const strict: PlacementOptions = { anywhere: false, overwrite: true };

describe('RestrictionMap', () => {
  it('decodes run-length data and treats out-of-bounds tiles as blocked', () => {
    // 3x2 map: two open tiles, one impassable (7), then three not-buildable (c = 2).
    const map = RestrictionMap.decode(3, 2, '2a1h3c');
    expect(map.isBlocked(0, 0, 'buildable')).toBe(false);
    expect(map.isBlocked(2, 0, 'accessible')).toBe(true);
    expect(map.isBlocked(0, 1, 'buildable')).toBe(true);
    expect(map.isBlocked(0, 1, 'accessible')).toBe(false);
    expect(map.bits(1, 1)).toBe(NOT_BUILDABLE);
    expect(map.isBlocked(-1, 0, 'accessible')).toBe(true);
    expect(map.isBlocked(3, 0, 'accessible')).toBe(true);
  });
});

describe('placement', () => {
  let doc: PlanDocument;
  let map: RestrictionMap;

  beforeEach(() => {
    doc = new PlanDocument(10, 10);
    map = RestrictionMap.open(10, 10);
  });

  it('builds rectangles from corners in any order', () => {
    expect(rectFromCorners(4, 5, 2, 1)).toEqual({ x: 2, y: 1, width: 3, height: 5 });
  });

  it('paints a rectangle of tiles and undoes it', () => {
    const patch = paintTiles(doc, map, item('road'), { x: 1, y: 1, width: 3, height: 2 }, strict);
    doc.apply(patch);
    expect(doc.tileCount).toBe(6);
    doc.apply(invertPatch(patch));
    expect(doc.tileCount).toBe(0);
  });

  it('keeps existing tiles when overwrite is off', () => {
    doc.apply(paintTiles(doc, map, item('road'), { x: 0, y: 0, width: 1, height: 1 }, strict));
    const patch = paintTiles(doc, map, item('wood-floor'), { x: 0, y: 0, width: 2, height: 1 }, { ...strict, overwrite: false });
    expect(patch.tiles).toEqual([{ x: 1, y: 0, before: null, after: 'wood-floor' }]);
  });

  it('respects restriction layers unless placing anywhere', () => {
    const blocked = RestrictionMap.decode(10, 10, '1c99a');
    expect(checkObject(doc, blocked, item('silo'), 0, 0, strict).blocked).toEqual([[0, 0]]);
    expect(checkObject(doc, blocked, item('silo'), 0, 0, { ...strict, anywhere: true }).ok).toBe(true);
  });

  it('stops objects overlapping, and allows craftables on paths but not buildings', () => {
    doc.apply(placeObjects(doc, map, item('silo'), { x: 0, y: 0, width: 1, height: 1 }, strict));
    expect(checkObject(doc, map, item('keg'), 2, 2, strict).ok).toBe(false);

    doc.apply(paintTiles(doc, map, item('road'), { x: 5, y: 5, width: 3, height: 3 }, strict));
    expect(checkObject(doc, map, item('keg'), 5, 5, strict).ok).toBe(true);
    expect(checkObject(doc, map, item('well'), 5, 5, strict).ok).toBe(false);
  });

  it('fills a dragged rectangle with copies stepped by the footprint', () => {
    const patch = placeObjects(doc, map, item('keg'), { x: 0, y: 0, width: 3, height: 2 }, strict);
    expect(patch.objects).toHaveLength(6);
    const silos = placeObjects(doc, map, item('silo'), { x: 0, y: 0, width: 7, height: 3 }, strict);
    expect(silos.objects.map((o) => o.after?.x)).toEqual([0, 3]);
  });

  it('erases tiles and any object touching the rectangle', () => {
    doc.apply(paintTiles(doc, map, item('road'), { x: 0, y: 0, width: 4, height: 1 }, strict));
    doc.apply(placeObjects(doc, map, item('silo'), { x: 5, y: 5, width: 1, height: 1 }, strict));
    doc.apply(erase(doc, { x: 3, y: 0, width: 3, height: 6 }));
    expect(doc.tileCount).toBe(3);
    expect(doc.objectCount).toBe(0);
  });

  it('moves objects as a group and refuses blocked moves', () => {
    doc.apply(placeObjects(doc, map, item('keg'), { x: 0, y: 0, width: 2, height: 1 }, strict));
    const uids = [...doc.allObjects()].map((o) => o.uid);
    // The kegs shift right by one: the first lands where the second was, which is fine within a group move.
    const patch = moveObjects(doc, map, uids, 1, 0, strict);
    expect(patch).not.toBeNull();
    doc.apply(patch!);
    expect(doc.objectAt(0, 0)).toBeNull();
    expect(doc.objectAt(2, 0)).not.toBeNull();
    expect(moveObjects(doc, map, uids, 20, 0, strict)).toBeNull();
  });

  describe('replacing crops', () => {
    it('lets sprinklers and scarecrows replace crops, and undo brings the crop back', () => {
      doc.apply(paintTiles(doc, map, item('parsnip'), { x: 0, y: 0, width: 3, height: 3 }, strict));
      const patch = placeObjects(doc, map, item('q-sprinkler'), { x: 1, y: 1, width: 1, height: 1 }, strict);
      expect(patch.tiles).toEqual([{ x: 1, y: 1, before: 'parsnip', after: null }]);
      doc.apply(patch);
      expect(doc.tileAt(1, 1)).toBeNull();
      expect(doc.tileCount).toBe(8);
      doc.apply(invertPatch(patch));
      expect(doc.tileAt(1, 1)).toBe('parsnip');
      expect(doc.objectAt(1, 1)).toBeNull();

      expect(checkObject(doc, map, item('scarecrow'), 0, 0, strict).ok).toBe(true);
    });

    it('still blocks other objects on crops, and range items on paths keep the path', () => {
      doc.apply(paintTiles(doc, map, item('parsnip'), { x: 0, y: 0, width: 1, height: 1 }, strict));
      expect(checkObject(doc, map, item('keg'), 0, 0, strict).ok).toBe(false);
      doc.apply(paintTiles(doc, map, item('road'), { x: 2, y: 0, width: 1, height: 1 }, strict));
      expect(placeObjects(doc, map, item('sprinkler'), { x: 2, y: 0, width: 1, height: 1 }, strict).tiles).toEqual([]);
    });

    it('replaces crops where a moved sprinkler lands', () => {
      doc.apply(paintTiles(doc, map, item('parsnip'), { x: 3, y: 0, width: 1, height: 1 }, strict));
      doc.apply(placeObjects(doc, map, item('sprinkler'), { x: 0, y: 0, width: 1, height: 1 }, strict));
      const uid = doc.objectAt(0, 0)!.uid;
      const patch = moveObjects(doc, map, [uid], 3, 0, strict)!;
      expect(patch.tiles).toEqual([{ x: 3, y: 0, before: 'parsnip', after: null }]);
    });
  });
});
