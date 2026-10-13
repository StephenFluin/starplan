import { findItem } from '../data/catalog';
import { rangeTiles } from './range';

const range = (id: string) => {
  const r = findItem(id)?.range;
  if (!r) throw new Error(`${id} has no range`);
  return r;
};

describe('rangeTiles', () => {
  it('waters the four neighbours for a basic sprinkler', () => {
    expect(rangeTiles(range('sprinkler'), 5, 5).sort()).toEqual([[4, 5], [5, 4], [5, 6], [6, 5]].sort());
  });

  it('covers 8, 24 and 48 tiles for quality, iridium and pressurised iridium sprinklers', () => {
    expect(rangeTiles(range('q-sprinkler'), 0, 0)).toHaveLength(8);
    expect(rangeTiles(range('irid-sprinkler'), 0, 0)).toHaveLength(24);
    expect(rangeTiles(range('irid-pressured-sprinkler'), 0, 0)).toHaveLength(48);
  });

  it('gives scarecrows the in-game 248 and 888 tile areas', () => {
    // Tiles within euclidean distance < 9 (or < 17), excluding the scarecrow's own tile.
    expect(rangeTiles(range('scarecrow'), 0, 0)).toHaveLength(248);
    expect(rangeTiles(range('deluxe-scarecrow'), 0, 0)).toHaveLength(888);
  });

  it('centres the junimo hut range on the tile below its door', () => {
    const tiles = rangeTiles(range('junimo-hut'), 10, 10);
    expect(tiles).toHaveLength(17 * 17);
    expect(tiles[0]).toEqual([3, 3]);
  });

  it('gives bee houses a diamond of radius 5', () => {
    expect(rangeTiles(range('bee-hive'), 0, 0)).toHaveLength(60);
  });
});
