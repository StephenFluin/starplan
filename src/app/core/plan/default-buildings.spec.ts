import { readFileSync } from 'node:fs';
import { LAYOUTS } from '../data/layouts';
import { findItem } from '../data/catalog';
import { restrictionsWithBuildings } from './building-ground';
import {
  addDefaultBuildings,
  applyEdit,
  defaultBuildings,
  greenhouseDirtShown,
} from './default-buildings';
import { PlanDocument, invertPatch } from './plan-document';
import { PlacementOptions, erase, moveObjects, paintTiles, placeObjects } from './placement';
import { RestrictionMap } from './restriction-map';

const options: PlacementOptions = { anywhere: false, overwrite: true };
const regular = LAYOUTS.find((l) => l.id === 'regular')!;

/** A new Standard Farm, with restrictions worked out like PlannerStore.restrictionsIgnoring. */
function standardFarm() {
  const base = RestrictionMap.decode(
    regular.width,
    regular.height,
    readFileSync('public/assets/restrictions/regular.txt', 'utf8'),
  );
  const dirt = regular.greenhouseDirt!;
  const withDirt = base.withArea(dirt.x, dirt.y, dirt.width, dirt.height, dirt.restrictions);
  const doc = new PlanDocument(regular.width, regular.height);
  doc.apply(addDefaultBuildings(doc, regular));
  return {
    doc,
    /** Restrictions now, leaving out objects about to move. */
    map(...moving: number[]): RestrictionMap {
      return restrictionsWithBuildings(
        greenhouseDirtShown(doc, regular) ? withDirt : base,
        doc,
        new Set(moving),
      );
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
    const away = moveObjects(doc, map(uid), [uid], -3, 1, options)!;
    expect(away).not.toBeNull();
    doc.apply(away);
    expect(moveObjects(doc, map(uid), [uid], 3, -1, options)).not.toBeNull();
    expect(map().isBlocked(53, 6, 'accessible')).toBe(true);
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
        const there = moveObjects(doc, farm.map(uid), [uid], dx, 0, options);
        expect(there, `move by ${dx}`).not.toBeNull();
        applyEdit(doc, regular, there!);
        const back = moveObjects(doc, farm.map(uid), [uid], -dx, 0, options);
        expect(back, `move back from ${dx}`).not.toBeNull();
        applyEdit(doc, regular, back!);
      }
    });
  }

  // The base map has a grass patch under the greenhouse's start location, with an unbuildable
  // edge at x = 33. As in the game (Farm.ClearGreenhouseGrassTiles), the greenhouse's first move
  // covers it with sand for good.
  it("clears the grass at the greenhouse's start once it first moves, as the game does", () => {
    const farm = standardFarm();
    const { doc } = farm;
    const uid = doc.objectAt(25, 10)!.uid;
    expect(farm.map(uid).isBlocked(33, 12, 'buildable')).toBe(true);
    expect(moveObjects(doc, farm.map(uid), [uid], 3, 0, options)).toBeNull();

    const away = moveObjects(doc, farm.map(uid), [uid], -3, 0, options)!;
    applyEdit(doc, regular, away);
    expect(doc.greenhouseMoved).toBe(true);
    expect(farm.map(uid).isBlocked(33, 12, 'buildable')).toBe(false);
    expect(moveObjects(doc, farm.map(uid), [uid], 6, 0, options)).not.toBeNull();

    // Undoing the first move brings the grass back.
    doc.apply(invertPatch(away));
    expect(greenhouseDirtShown(doc, regular)).toBe(false);
    expect(farm.map(uid).isBlocked(33, 12, 'buildable')).toBe(true);
  });

  it('lets the greenhouse move over a cobblestone path, which stays under it', () => {
    const farm = standardFarm();
    const { doc } = farm;
    const uid = doc.objectAt(25, 10)!.uid;
    applyEdit(doc, regular, moveObjects(doc, farm.map(uid), [uid], -3, 0, options)!);
    doc.apply(
      paintTiles(
        doc,
        farm.map(),
        findItem('road')!,
        { x: 30, y: 10, width: 4, height: 8 },
        options,
      ),
    );
    const over = moveObjects(doc, farm.map(uid), [uid], 6, 0, options);
    expect(over).not.toBeNull();
    applyEdit(doc, regular, over!);
    expect(doc.tileAt(31, 12)).toBe('road');
    // Its doorstep and door now stand on the path.
    expect(doc.objectAt(31, 16)).toBeNull();
    expect(doc.tileAt(31, 16)).toBe('road');
  });

  it('lets a deleted greenhouse be built again where it started', () => {
    const farm = standardFarm();
    const { doc } = farm;
    applyEdit(doc, regular, erase(doc, { x: 25, y: 10, width: 1, height: 1 }));
    expect(doc.objectAt(25, 10)).toBeNull();
    expect(
      placeObjects(
        doc,
        farm.map(),
        findItem('greenhouse')!,
        { x: 25, y: 10, width: 1, height: 1 },
        options,
      ).objects,
    ).toHaveLength(1);
  });

  it('lets the shipping bin move and return', () => {
    const { doc, map } = standardFarm();
    const uid = doc.objectAt(71, 14)!.uid;
    const away = moveObjects(doc, map(uid), [uid], 3, 0, options)!;
    expect(away).not.toBeNull();
    doc.apply(away);
    expect(moveObjects(doc, map(uid), [uid], -3, 0, options)).not.toBeNull();
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
        expect(moveObjects(doc, map(uid), [uid], 0, dy, options), `move down ${dy}`).not.toBeNull();
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
