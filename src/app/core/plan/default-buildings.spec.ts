import { readFileSync } from 'node:fs';
import { LAYOUTS } from '../data/layouts';
import { addDefaultBuildings, defaultBuildings } from './default-buildings';
import { PlanDocument } from './plan-document';
import { PlacementOptions, moveObjects } from './placement';
import { RestrictionMap } from './restriction-map';

const options: PlacementOptions = { anywhere: false, overwrite: true };
const regular = LAYOUTS.find((l) => l.id === 'regular')!;

function standardFarm(): { doc: PlanDocument; map: RestrictionMap } {
  const map = RestrictionMap.decode(regular.width, regular.height, readFileSync('public/assets/restrictions/regular.txt', 'utf8'));
  const doc = new PlanDocument(regular.width, regular.height);
  doc.apply(addDefaultBuildings(doc, regular));
  return { doc, map };
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

  for (const [name, start] of [
    ['farmhouse', { x: 59, y: 12 }],
    ['greenhouse', { x: 25, y: 10 }],
  ] as const) {
    it(`lets the ${name} move a few tiles left or right and back again`, () => {
      const { doc, map } = standardFarm();
      const uid = doc.objectAt(start.x, start.y)!.uid;
      // The game's map data marks the ground three tiles to the right of both as unbuildable.
      for (const dx of [-3, -1, 1]) {
        const there = moveObjects(doc, map, [uid], dx, 0, options);
        expect(there, `move by ${dx}`).not.toBeNull();
        doc.apply(there!);
        const back = moveObjects(doc, map, [uid], -dx, 0, options);
        expect(back, `move back from ${dx}`).not.toBeNull();
        doc.apply(back!);
      }
    });
  }

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
