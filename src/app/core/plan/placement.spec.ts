import { findItem } from '../data/catalog';
import { PlanDocument, invertPatch } from './plan-document';
import { Group, PlacementOptions, checkObject, erase, lineCells, moveObjects, paintTiles, placeEach, placeObjects, putGroup, rectFromCorners } from './placement';
import { IMPASSABLE, NOT_BUILDABLE, RestrictionMap } from './restriction-map';

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

  it('stops objects overlapping, and allows craftables on paths but not crops', () => {
    doc.apply(placeObjects(doc, map, item('silo'), { x: 0, y: 0, width: 1, height: 1 }, strict));
    expect(checkObject(doc, map, item('keg'), 2, 2, strict).ok).toBe(false);

    doc.apply(paintTiles(doc, map, item('road'), { x: 5, y: 5, width: 3, height: 3 }, strict));
    doc.apply(paintTiles(doc, map, item('parsnip'), { x: 9, y: 9, width: 1, height: 1 }, strict));
    expect(checkObject(doc, map, item('keg'), 5, 5, strict).ok).toBe(true);
    expect(checkObject(doc, map, item('keg'), 9, 9, strict).ok).toBe(false);
  });

  describe('freehand strokes', () => {
    it('join up the cells between pointer samples', () => {
      expect(lineCells(0, 0, 3, 1)).toEqual([[0, 0], [1, 0], [2, 1], [3, 1]]);
      expect(lineCells(2, 2, 2, 0)).toEqual([[2, 2], [2, 1], [2, 0]]);
      expect(lineCells(1, 1, 1, 1)).toEqual([[1, 1]]);
    });

    it('paint and erase just the cells they cross', () => {
      const stroke: [number, number][] = [[0, 0], [1, 0], [1, 1], [1, 0]];
      const patch = paintTiles(doc, map, item('road'), stroke, strict);
      expect(patch.tiles).toHaveLength(3);
      doc.apply(patch);
      doc.apply(erase(doc, [[1, 1]]));
      expect(doc.tileCount).toBe(2);
    });

    it('place objects clear of the copies before them', () => {
      const patch = placeEach(doc, map, item('large-rock'), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], strict);
      expect(patch.objects.map((o) => o.after?.x)).toEqual([0, 2]);
    });
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

  // As in the game (GameLocation.buildStructure and Data/Buildings.json).
  describe('buildings', () => {
    const paint = (id: string, x: number, y: number, width = 1, height = 1) => doc.apply(paintTiles(doc, map, item(id), { x, y, width, height }, strict));
    const place = (id: string, x: number, y: number, on = map) => {
      const patch = placeObjects(doc, on, item(id), { x, y, width: 1, height: 1 }, strict);
      doc.apply(patch);
      return patch;
    };

    it('go over floors, keeping them, and clear grass and tilled soil', () => {
      paint('road', 0, 0, 3, 1);
      paint('grass', 0, 1, 3, 1);
      paint('farmland', 0, 2, 3, 1);
      const patch = place('silo', 0, 0);
      expect(patch.objects).toHaveLength(1);
      expect(patch.tiles.map((t) => t.before)).toEqual(['grass', 'grass', 'grass', 'farmland', 'farmland', 'farmland']);
      expect(doc.tileAt(1, 0)).toBe('road');
      expect(doc.tileAt(1, 1)).toBeNull();
      doc.apply(invertPatch(patch));
      expect(doc.tileAt(1, 1)).toBe('grass');
      expect(doc.tileAt(1, 2)).toBe('farmland');
    });

    it('lose the floor under a Well', () => {
      paint('road', 0, 0, 3, 3);
      expect(place('well', 0, 0).tiles).toHaveLength(9);
      expect(doc.tileCount).toBe(0);
    });

    it("can't go over crops, fences or debris", () => {
      for (const id of ['parsnip', 'fence', 'stone', 'trellis']) {
        doc.clear();
        paint(id, 1, 1);
        expect(checkObject(doc, map, item('silo'), 0, 0, strict).blocked, id).toEqual([[1, 1]]);
      }
    });

    it('have nothing painted under them once standing', () => {
      place('silo', 0, 0);
      paint('road', 0, 0, 5, 1);
      expect(doc.tileAt(2, 0)).toBeNull();
      expect(doc.tileAt(3, 0)).toBe('road');
    });

    it('need the tile in front of their door buildable or a path', () => {
      // A coop's door is at (1, 2) of its 6x3 footprint.
      const front = map.withTiles([[1, 3, NOT_BUILDABLE]]);
      expect(checkObject(doc, front, item('coop'), 0, 0, strict).blocked).toEqual([[1, 3]]);
      paint('road', 1, 3);
      expect(checkObject(doc, front, item('coop'), 0, 0, strict).ok).toBe(true);
      place('keg', 1, 3);
      expect(checkObject(doc, front, item('coop'), 0, 0, strict).blocked).toEqual([[1, 3]]);
    });

    it("need the greenhouse's doorstep passable, though only the tile at its door buildable", () => {
      // The doorstep is the 3x2 below the greenhouse's 7x6 footprint, two tiles in; the door is above (4, 6).
      const unbuildable = map.withTiles([[3, 6, NOT_BUILDABLE], [5, 6, NOT_BUILDABLE], [4, 7, NOT_BUILDABLE]]);
      expect(checkObject(doc, unbuildable, item('greenhouse'), 1, 0, strict).ok).toBe(true);
      paint('parsnip', 3, 6);
      expect(checkObject(doc, unbuildable, item('greenhouse'), 1, 0, strict).ok).toBe(true);
      paint('fence', 5, 7);
      expect(checkObject(doc, unbuildable, item('greenhouse'), 1, 0, strict).blocked).toEqual([[5, 7]]);
      const water = map.withTiles([[4, 7, IMPASSABLE | NOT_BUILDABLE]]);
      expect(checkObject(doc, water, item('greenhouse'), 1, 0, strict).blocked).toEqual([[4, 7], [5, 7]]);

      const door = map.withTiles([[4, 6, NOT_BUILDABLE]]);
      expect(checkObject(doc, door, item('greenhouse'), 1, 0, strict).blocked).toEqual([[5, 7], [4, 6]]);
      paint('road', 4, 6);
      expect(checkObject(doc, door, item('greenhouse'), 1, 0, strict).blocked).toEqual([[5, 7]]);
    });

    it('say why they are blocked', () => {
      const reason = (id: string, x: number, y: number, on = map) => checkObject(doc, on, item(id), x, y, strict).reason;
      expect(reason('silo', 8, 8)).toEqual({ kind: 'outside' });
      expect(reason('silo', 0, 0, map.withTiles([[1, 1, NOT_BUILDABLE]]))).toEqual({ kind: 'ground', restriction: 'buildable' });
      expect(reason('silo', 0, 0, map.withTiles([[1, 1, IMPASSABLE | NOT_BUILDABLE]]))).toEqual({ kind: 'ground', restriction: 'accessible' });
      expect(reason('coop', 0, 0, map.withTiles([[1, 3, NOT_BUILDABLE]]))).toEqual({ kind: 'door' });
      expect(reason('greenhouse', 1, 0, map.withTiles([[3, 7, IMPASSABLE]]))).toEqual({ kind: 'clearance' });
      place('keg', 1, 1);
      paint('fence', 2, 2);
      expect(reason('silo', 0, 0)).toEqual({ kind: 'object', itemId: 'keg' });
      expect(reason('silo', 1, 2)).toEqual({ kind: 'tile', itemId: 'fence' });
    });

    it('may keep standing on their own tiles when they move, as in the game', () => {
      const unbuildable = map.withTiles([0, 1, 2].flatMap((y) => [0, 1, 2].map((x) => [x, y, NOT_BUILDABLE] as const)));
      place('silo', 0, 0, RestrictionMap.open(10, 10));
      const uid = doc.objectAt(0, 0)!.uid;
      expect(moveObjects(doc, unbuildable, [uid], 1, 0, strict)).not.toBeNull();
      expect(moveObjects(doc, unbuildable, [uid], 0, -1, strict)).toBeNull();
    });
  });

  describe('groups', () => {
    /** A 3x3 parsnip field with a sprinkler in the middle, as a selection would hold it. */
    const field = (): Group => {
      doc.apply(paintTiles(doc, map, item('parsnip'), { x: 0, y: 0, width: 3, height: 3 }, strict));
      doc.apply(placeObjects(doc, map, item('sprinkler'), { x: 1, y: 1, width: 1, height: 1 }, strict));
      return {
        tiles: [...doc.allTiles()].map(([cell, itemId]) => ({ x: Number(cell.split(',')[0]), y: Number(cell.split(',')[1]), itemId })),
        objects: [...doc.allObjects()],
      };
    };

    it('move tiles and objects together, and undo puts them back', () => {
      const group = field();
      const { patch, blocked } = putGroup(doc, map, group, 4, 0, strict, true);
      expect(blocked).toEqual([]);
      doc.apply(patch);
      expect(doc.tileAt(0, 0)).toBeNull();
      expect(doc.tileAt(4, 0)).toBe('parsnip');
      expect(doc.objectAt(5, 1)?.uid).toBe(group.objects[0].uid);
      expect(doc.tileCount).toBe(8);
      doc.apply(invertPatch(patch));
      expect(doc.tileAt(0, 0)).toBe('parsnip');
      expect(doc.tileAt(4, 0)).toBeNull();
      expect(doc.objectAt(1, 1)?.itemId).toBe('sprinkler');
    });

    it('may land partly where they were', () => {
      const group = field();
      doc.apply(putGroup(doc, map, group, 1, 1, strict, true).patch);
      expect(doc.tileAt(0, 0)).toBeNull();
      expect(doc.tileAt(3, 3)).toBe('parsnip');
      expect(doc.objectAt(2, 2)?.itemId).toBe('sprinkler');
      expect(doc.tileCount).toBe(8);
    });

    it("don't land on objects or ground they can't go on", () => {
      const group = field();
      doc.apply(placeObjects(doc, map, item('keg'), { x: 5, y: 0, width: 1, height: 1 }, strict));
      expect(putGroup(doc, map, group, 4, 0, strict, true).blocked).toEqual([[5, 0]]);
      const untillable = map.withTiles([[4, 2, 4]]);
      expect(putGroup(doc, untillable, group, 4, 1, strict, true).blocked).toEqual([[4, 2]]);
    });

    it('paint over tiles they land on only when painting over is on', () => {
      const group = field();
      doc.apply(paintTiles(doc, map, item('road'), { x: 4, y: 0, width: 1, height: 1 }, strict));
      expect(putGroup(doc, map, group, 4, 0, { ...strict, overwrite: false }, true).blocked).toEqual([[4, 0]]);
      doc.apply(putGroup(doc, map, group, 4, 0, strict, true).patch);
      expect(doc.tileAt(4, 0)).toBe('parsnip');
    });

    it('can be copies, with new ids, leaving the originals', () => {
      const group = field();
      const { patch } = putGroup(doc, map, group, 0, 4, strict, false);
      doc.apply(patch);
      expect(doc.tileCount).toBe(16);
      expect(doc.objectCount).toBe(2);
      expect(doc.objectAt(1, 5)?.uid).not.toBe(group.objects[0].uid);
    });
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

    it("doesn't paint crops under a sprinkler", () => {
      doc.apply(placeObjects(doc, map, item('sprinkler'), { x: 1, y: 1, width: 1, height: 1 }, strict));
      doc.apply(paintTiles(doc, map, item('parsnip'), { x: 0, y: 0, width: 3, height: 3 }, strict));
      expect(doc.tileAt(1, 1)).toBeNull();
      expect(doc.tileCount).toBe(8);
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
