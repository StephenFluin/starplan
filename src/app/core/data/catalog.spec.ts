import { CATALOG, spriteOverhang, spriteUrl } from './catalog';
import { GAME_ART } from './game-art.generated';

describe('catalog', () => {
  it('has unique ids', () => {
    const ids = CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the game's footprints for every item with game art", () => {
    for (const item of CATALOG.filter((i) => i.art)) {
      expect([item.id, item.width, item.height]).toEqual([item.id, item.art!.footprint.width, item.art!.footprint.height]);
    }
  });

  it('attaches every imported building to a catalog item', () => {
    const ids = new Set(CATALOG.map((item) => item.id));
    for (const id of Object.keys(GAME_ART)) expect(ids.has(id), id).toBe(true);
  });

  it('serves game art from assets/game and measures roofs from it', () => {
    const house = CATALOG.find((item) => item.id === 'house')!;
    expect(spriteUrl(house)).toBe('assets/game/house.png');
    // 144px tall art, drawn 2px low, on a 5-row footprint: the roof covers 4 rows above it.
    expect(spriteOverhang(house)).toBe(4);
    const keg = CATALOG.find((item) => item.id === 'keg')!;
    expect(spriteUrl(keg)).toBe('assets/sprites/keg.png');
  });
});
