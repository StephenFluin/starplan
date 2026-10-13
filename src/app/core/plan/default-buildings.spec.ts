import { readFileSync } from 'node:fs';
import { LAYOUTS } from '../data/layouts.generated';
import { addDefaultBuildings, defaultBuildings, openDefaultSpots } from './default-buildings';
import { PlanDocument } from './plan-document';
import { PlacementOptions, moveObjects } from './placement';
import { RestrictionMap } from './restriction-map';

const options: PlacementOptions = { anywhere: false, overwrite: true };
const regular = LAYOUTS.find((l) => l.id === 'regular')!;

function standardFarm(): { doc: PlanDocument; map: RestrictionMap } {
  const map = RestrictionMap.decode(regular.width, regular.height, readFileSync('public/assets/restrictions/regular.txt', 'utf8'));
  openDefaultSpots(map, regular);
  const doc = new PlanDocument(regular.width, regular.height);
  doc.apply({ tiles: [], objects: addDefaultBuildings(doc, regular) });
  return { doc, map };
}

describe('default buildings', () => {
  it('places footprints below the roof overhang', () => {
    expect(defaultBuildings(regular)).toEqual([
      { itemId: 'house', x: 59, y: 12 },
      { itemId: 'greenhouse', x: 25, y: 10 },
      { itemId: 'shipping-bin', x: 71, y: 14 },
    ]);
  });

  for (const [name, start] of [
    ['farmhouse', { x: 59, y: 12 }],
    ['greenhouse', { x: 25, y: 10 }],
  ] as const) {
    it(`lets the ${name} move a few tiles left or right and back again`, () => {
      const { doc, map } = standardFarm();
      const uid = doc.objectAt(start.x, start.y)!.uid;
      for (const dx of [-3, -1, 1, 3]) {
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
    // Three tiles right is open ground (straight down is marked unbuildable in the map data).
    const away = moveObjects(doc, map, [uid], 3, 0, options)!;
    expect(away).not.toBeNull();
    doc.apply(away);
    expect(moveObjects(doc, map, [uid], -3, 0, options)).not.toBeNull();
  });
});
