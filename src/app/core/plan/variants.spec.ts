import { CATALOG, VARIANT_FAMILIES, findItem, variantsOf } from '../data/catalog';
import { PlanDocument, invertPatch } from './plan-document';
import { PlacementOptions, placeObjects, swapObject } from './placement';
import { RestrictionMap } from './restriction-map';

const item = (id: string) => {
  const found = findItem(id);
  if (!found) throw new Error(`Unknown item ${id}`);
  return found;
};

const options: PlacementOptions = { anywhere: false, overwrite: true };

describe('variants', () => {
  it('only lists catalog items, each in at most one family', () => {
    const seen = new Set<string>();
    for (const family of VARIANT_FAMILIES) {
      for (const id of family) {
        expect(CATALOG.some((i) => i.id === id)).toBe(true);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it('keeps footprints identical within building families', () => {
    for (const family of VARIANT_FAMILIES) {
      const items = family.map(item);
      if (items[0].category !== 'buildings') continue;
      for (const variant of items) {
        expect([variant.width, variant.height]).toEqual([items[0].width, items[0].height]);
      }
    }
  });

  it('resolves legacy ids and items without variants', () => {
    expect(variantsOf('greenhouse').map((i) => i.id)).toEqual(['greenhouse', 'greenhouse-fixed']);
    expect(variantsOf('keg')).toEqual([]);
  });

  it('swaps a placed object in place and undoes cleanly', () => {
    const doc = new PlanDocument(20, 20);
    const map = RestrictionMap.open(20, 20);
    doc.apply(placeObjects(doc, map, item('scarecrow'), { x: 4, y: 4, width: 1, height: 1 }, options));
    const [scarecrow] = [...doc.allObjects()];
    const patch = swapObject(doc, map, scarecrow.uid, item('deluxe-scarecrow'), options)!;
    doc.apply(patch);
    expect(doc.objectAt(4, 4)).toEqual({ ...scarecrow, itemId: 'deluxe-scarecrow' });
    doc.apply(invertPatch(patch));
    expect(doc.objectAt(4, 4)?.itemId).toBe('scarecrow');
  });

  it('refuses a variant whose footprint does not fit', () => {
    const doc = new PlanDocument(20, 20);
    // Only the scarecrow's own tile is open, so a larger replacement would be blocked.
    const map = RestrictionMap.decode(20, 20, '84h1a315h');
    doc.apply(placeObjects(doc, map, item('scarecrow'), { x: 4, y: 4, width: 1, height: 1 }, options));
    const [scarecrow] = [...doc.allObjects()];
    expect(swapObject(doc, map, scarecrow.uid, item('silo'), options)).toBeNull();
    expect(swapObject(doc, map, scarecrow.uid, item('deluxe-scarecrow'), options)).not.toBeNull();
  });

  it('allows swapping in place even where the restriction data says the tiles are blocked', () => {
    // Default buildings like the greenhouse sit on tiles marked unbuildable.
    const doc = new PlanDocument(20, 20);
    const blockedEverywhere = RestrictionMap.decode(20, 20, '400h');
    doc.apply({ tiles: [], objects: [{ uid: 1, before: null, after: { uid: 1, itemId: 'greenhouse', x: 2, y: 2 } }] });
    expect(swapObject(doc, blockedEverywhere, 1, item('greenhouse-fixed'), options)).not.toBeNull();
  });
});
