import { readFileSync } from 'node:fs';
import { LAYOUTS } from '../data/layouts';
import { addDefaultBuildings, applyEdit, defaultBuildings, greenhouseDirtShown } from './default-buildings';
import { PlanDocument, invertPatch } from './plan-document';
import { PlacementOptions, moveObjects } from './placement';
import { RestrictionMap } from './restriction-map';

const options: PlacementOptions = { anywhere: false, overwrite: true };
const regular = LAYOUTS.find((l) => l.id === 'regular')!;

/** A new Standard Farm, with restrictions chosen like PlannerStore.restrictions. */
function standardFarm() {
  const base = RestrictionMap.decode(regular.width, regular.height, readFileSync('public/assets/restrictions/regular.txt', 'utf8'));
  const dirt = regular.greenhouseDirt!;
  const withDirt = base.withArea(dirt.x, dirt.y, dirt.width, dirt.height, dirt.restrictions);
  const doc = new PlanDocument(regular.width, regular.height);
  doc.apply(addDefaultBuildings(doc, regular));
  return {
    doc,
    get map(): RestrictionMap {
      return greenhouseDirtShown(doc, regular) ? withDirt : base;
    },
  };
}

describe('default buildings', () => {
  it('places footprints below the roof overhang', () => {
    expect(defaultBuildings(regular)).toEqual([
      { itemId: 'house', x: 59, y: 12 },
      { itemId: 'greenhouse', x: 25, y: 10 },
      { itemId: 'shipping-bin', x: 71, y: 14 },
      { itemId: 'pet-bowl', x: 53, y: 7 },
    ]);
  });

  it('lets the pet bowl move and return, but keeps the fence behind it', () => {
    const { doc, map } = standardFarm();
    const uid = doc.objectAt(53, 7)!.uid;
    const away = moveObjects(doc, map, [uid], -3, 1, options)!;
    expect(away).not.toBeNull();
    doc.apply(away);
    expect(moveObjects(doc, map, [uid], 3, -1, options)).not.toBeNull();
    expect(map.isBlocked(53, 6, 'accessible')).toBe(true);
  });

  for (const [name, start, moves] of [
    // Three tiles right of each is unbuildable: the farmhouse's yard path, and the grass edge that
    // is back under the greenhouse once it has moved.
    ['farmhouse', { x: 59, y: 12 }, [-3, -1, 1]],
    ['greenhouse', { x: 25, y: 10 }, [-3, -1, 1]],
  ] as const) {
    it(`lets the ${name} move a few tiles left or right and back again`, () => {
      const farm = standardFarm();
      const { doc } = farm;
      const uid = doc.objectAt(start.x, start.y)!.uid;
      for (const dx of moves) {
        const there = moveObjects(doc, farm.map, [uid], dx, 0, options);
        expect(there, `move by ${dx}`).not.toBeNull();
        applyEdit(doc, regular, there!);
        const back = moveObjects(doc, farm.map, [uid], -dx, 0, options);
        expect(back, `move back from ${dx}`).not.toBeNull();
        applyEdit(doc, regular, back!);
      }
    });
  }

  // The base map has a grass patch, with an unbuildable edge at x = 33, where the greenhouse
  // starts. The game covers it with sand until the greenhouse first moves; then the grass is back
  // for good.
  it("lifts the greenhouse's dirt patch for good once it moves, as the game does", () => {
    const farm = standardFarm();
    const { doc } = farm;
    const uid = doc.objectAt(25, 10)!.uid;
    expect(farm.map.isBlocked(33, 12, 'buildable')).toBe(false);

    const away = moveObjects(doc, farm.map, [uid], 3, 0, options)!;
    expect(away).not.toBeNull();
    applyEdit(doc, regular, away);
    expect(doc.greenhouseMoved).toBe(true);
    expect(farm.map.isBlocked(33, 12, 'buildable')).toBe(true);

    const home = moveObjects(doc, farm.map, [uid], -3, 0, options)!;
    applyEdit(doc, regular, home);
    expect(greenhouseDirtShown(doc, regular)).toBe(false);
    expect(moveObjects(doc, farm.map, [uid], 3, 0, options)).toBeNull();

    // Undoing the first move brings the patch back.
    doc.apply(invertPatch(home));
    doc.apply(invertPatch(away));
    expect(greenhouseDirtShown(doc, regular)).toBe(true);
  });

  it('lets the shipping bin move and return', () => {
    const { doc, map } = standardFarm();
    const uid = doc.objectAt(71, 14)!.uid;
    const away = moveObjects(doc, map, [uid], 3, 0, options)!;
    expect(away).not.toBeNull();
    doc.apply(away);
    expect(moveObjects(doc, map, [uid], -3, 0, options)).not.toBeNull();
  });

  // Nothing in the map data should reserve the ground in front of a default building.
  for (const [name, start, steps] of [
    ['farmhouse', { x: 59, y: 12 }, [1, 2, 3]],
    ['greenhouse', { x: 25, y: 10 }, [1, 2]],
  ] as const) {
    it(`lets the ${name} move down over its old doorstep`, () => {
      const { doc, map } = standardFarm();
      const uid = doc.objectAt(start.x, start.y)!.uid;
      for (const dy of steps) {
        expect(moveObjects(doc, map, [uid], 0, dy, options), `move down ${dy}`).not.toBeNull();
      }
    });
  }

  it('starts the Meadowlands Farm with a coop in a fenced yard', () => {
    const meadowlands = LAYOUTS.find((l) => l.id === 'ranching')!;
    const doc = new PlanDocument(meadowlands.width, meadowlands.height);
    doc.apply(addDefaultBuildings(doc, meadowlands));
    expect(doc.objectAt(54, 9)?.itemId).toBe('coop');
    expect(doc.objectAt(62, 13)?.itemId).toBe('gate');
    expect(doc.tileAt(47, 20)).toBe('fence');
    expect(doc.tileAt(62, 7)).toBe('fence');
    expect(doc.tileAt(62, 13)).toBeNull();
  });
});
