import { findItem } from '../data/catalog';
import { PlanDocument } from './plan-document';
import { PlacementOptions, TileRect, paintTiles } from './placement';
import { rangeTiles } from './range';
import { RestrictionMap } from './restriction-map';
import { TilePosition, coverageLayout } from './coverage-layout';

const item = (id: string) => {
  const found = findItem(id);
  if (!found) throw new Error(`Unknown item ${id}`);
  return found;
};

const options: PlacementOptions = { anywhere: false, overwrite: true };

const inside = (rect: TileRect, at: TilePosition) =>
  at.x >= rect.x && at.y >= rect.y && at.x < rect.x + rect.width && at.y < rect.y + rect.height;

/** Tiles in the rectangle that are neither in range nor holding an item. */
function dryTiles(id: string, rect: TileRect, layout: TilePosition[]): number {
  const wet = new Set<string>();
  for (const at of layout) {
    wet.add(`${at.x},${at.y}`);
    for (const [x, y] of rangeTiles(item(id).range!, at.x, at.y)) wet.add(`${x},${y}`);
  }
  let dry = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) if (!wet.has(`${x},${y}`)) dry++;
  }
  return dry;
}

describe('coverageLayout', () => {
  let doc: PlanDocument;
  let map: RestrictionMap;

  beforeEach(() => {
    doc = new PlanDocument(40, 40);
    map = RestrictionMap.open(40, 40);
  });

  const cases: [string, number, number][] = [
    // [sprinkler, rectangle size, expected count]
    ['q-sprinkler', 6, 4],
    ['q-sprinkler', 3, 1],
    ['q-sprinkler', 9, 9],
    ['irid-sprinkler', 5, 1],
    ['irid-sprinkler', 10, 4],
    ['irid-pressured-sprinkler', 7, 1],
    ['irid-pressured-sprinkler', 14, 4],
  ];

  for (const [id, size, expected] of cases) {
    it(`covers a ${size}x${size} field with ${expected} ${id}`, () => {
      const rect = { x: 5, y: 5, width: size, height: size };
      const layout = coverageLayout(doc, map, item(id), rect, options);
      expect(layout).toHaveLength(expected);
      expect(dryTiles(id, rect, layout)).toBe(0);
    });
  }

  it('uses the plus-shaped tiling for basic sprinklers', () => {
    const rect = { x: 5, y: 5, width: 10, height: 10 };
    const layout = coverageLayout(doc, map, item('sprinkler'), rect, options);
    expect(dryTiles('sprinkler', rect, layout)).toBe(0);
    // A perfect tiling needs 100 / 5 = 20; edges cost a few extra.
    expect(layout.length).toBeLessThanOrEqual(26);
  });

  it('puts edge sprinklers outside the drawn area when that costs nothing extra', () => {
    // 7x7 needs 9 quality sprinklers either way; 5 of them can sit just outside the field.
    const rect = { x: 5, y: 5, width: 7, height: 7 };
    const layout = coverageLayout(doc, map, item('q-sprinkler'), rect, options);
    expect(layout).toHaveLength(9);
    expect(dryTiles('q-sprinkler', rect, layout)).toBe(0);
    expect(layout.filter((at) => inside(rect, at))).toHaveLength(4);
  });

  it('keeps sprinklers inside when moving them out would need more', () => {
    const rect = { x: 5, y: 5, width: 6, height: 6 };
    const layout = coverageLayout(doc, map, item('q-sprinkler'), rect, options);
    expect(layout).toHaveLength(4);
    expect(layout.every((at) => inside(rect, at))).toBe(true);
  });

  it('never replaces crops outside the drawn area', () => {
    // Crops all around a 7x7 field: the edge sprinklers have to stay inside.
    doc.apply(paintTiles(doc, map, item('parsnip'), { x: 0, y: 0, width: 17, height: 17 }, options));
    const rect = { x: 5, y: 5, width: 7, height: 7 };
    const layout = coverageLayout(doc, map, item('q-sprinkler'), rect, options);
    expect(layout.every((at) => inside(rect, at))).toBe(true);
    expect(dryTiles('q-sprinkler', rect, layout)).toBe(0);
  });

  it('stays on the map at the map edge', () => {
    const rect = { x: 0, y: 0, width: 7, height: 7 };
    const layout = coverageLayout(doc, map, item('q-sprinkler'), rect, options);
    expect(layout.every((at) => at.x >= 0 && at.y >= 0)).toBe(true);
    expect(dryTiles('q-sprinkler', rect, layout)).toBe(0);
  });

  it('skips tiles that are already watered or cannot be tilled', () => {
    const rect = { x: 0, y: 0, width: 6, height: 3 };
    // The right half of the field can't be tilled, so only one 3x3 block needs water.
    const half = RestrictionMap.decode(40, 40, ['3a3e34a', '3a3e34a', '3a3e34a', '1480a'].join(''));
    expect(coverageLayout(doc, half, item('q-sprinkler'), rect, options)).toHaveLength(1);

    doc.apply({ tiles: [], objects: [{ uid: 1, before: null, after: { uid: 1, itemId: 'q-sprinkler', x: 1, y: 1 } }] });
    expect(coverageLayout(doc, map, item('q-sprinkler'), rect, options)).toEqual([{ x: 4, y: 1 }]);
  });

  it('does not place sprinklers on tiles where they are not allowed', () => {
    // Fences block objects, so sprinklers must go elsewhere but can still water the fence row.
    doc.apply(paintTiles(doc, map, item('fence'), { x: 0, y: 1, width: 3, height: 1 }, options));
    const layout = coverageLayout(doc, map, item('q-sprinkler'), { x: 0, y: 0, width: 3, height: 3 }, options);
    expect(layout.every((at) => at.y !== 1)).toBe(true);
  });

  // Rows used to come out shifted by a tile when the last one was pushed outside the area, e.g.
  // quality sprinklers on 8x4: x = 0, 3, 6 inside and x = 1, 4, 7 below.
  it('keeps square-range sprinklers on one grid when that costs nothing', () => {
    for (const id of ['q-sprinkler', 'irid-sprinkler']) {
      const step = item(id).range!.radius * 2 + 1;
      for (let height = 2; height <= 10; height++) {
        for (let width = 2; width <= 10; width++) {
          const rect = { x: 15, y: 15, width, height };
          const layout = coverageLayout(doc, map, item(id), rect, options);
          const classes = new Set(layout.map((at) => `${at.x % step},${at.y % step}`));
          expect(classes.size, `${id} ${width}x${height}`).toBe(1);
          expect(dryTiles(id, rect, layout), `${id} ${width}x${height}`).toBe(0);
        }
      }
    }
  });

  describe('scarecrows', () => {
    it('protects a whole field with few scarecrows', () => {
      const field = new PlanDocument(60, 60);
      const open = RestrictionMap.open(60, 60);
      // A scarecrow covers a radius-8 circle (248 tiles), so 30x30 = 900 tiles needs at least 4.
      const rect = { x: 10, y: 10, width: 30, height: 30 };
      const layout = coverageLayout(field, open, item('scarecrow'), rect, options);
      expect(dryTiles('scarecrow', rect, layout)).toBe(0);
      expect(layout.length).toBeGreaterThanOrEqual(4);
      expect(layout.length).toBeLessThanOrEqual(7);
    });

    it('needs one scarecrow for a small field, and puts it just outside when that reaches', () => {
      const rect = { x: 5, y: 5, width: 9, height: 9 };
      expect(coverageLayout(doc, map, item('scarecrow'), rect, options)).toHaveLength(1);
      const [row] = coverageLayout(doc, map, item('scarecrow'), { x: 5, y: 5, width: 9, height: 1 }, options);
      expect(row.y).not.toBe(5);
    });

    it('ignores sprinklers when counting existing coverage', () => {
      doc.apply({ tiles: [], objects: [{ uid: 1, before: null, after: { uid: 1, itemId: 'irid-pressured-sprinkler', x: 8, y: 8 } }] });
      expect(coverageLayout(doc, map, item('scarecrow'), { x: 5, y: 5, width: 7, height: 7 }, options)).toHaveLength(1);
    });
  });
});
