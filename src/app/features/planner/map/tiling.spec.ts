import { TILINGS } from '../../../core/data/game-art.generated';
import { Joins, fenceSum, tilePieces } from './tiling';

/** Joins on the given sides: n, e, s, w and the diagonals ne, nw, se, sw. */
const joining = (...sides: string[]): Joins => (dx, dy) => sides.includes(`${dy < 0 ? 'n' : dy > 0 ? 's' : ''}${dx > 0 ? 'e' : dx < 0 ? 'w' : ''}`);

describe('tiling', () => {
  it('picks the fence piece from the joined sides, standing one tile up', () => {
    expect(fenceSum(joining('e', 'w'))).toBe(110);
    const [piece] = tilePieces(TILINGS['fence'], 0, 0, joining('e', 'w'), false);
    // Piece 7: the third row's middle column.
    expect(piece).toMatchObject({ sx: 16, sy: 64, width: 16, height: 32, dy: -16 });
  });

  it('picks the floor piece from the joined sides, in its block of the sheet', () => {
    const [alone] = tilePieces(TILINGS['stone-floor'], 0, 0, joining(), false);
    expect(alone).toMatchObject({ file: 'flooring.png', sx: 64, sy: 0 });
    const [middle] = tilePieces(TILINGS['stone-floor'], 0, 0, joining('n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'), true);
    expect(middle).toMatchObject({ file: 'flooring-winter.png', sx: 64 + 32, sy: 16 });
  });

  it('fills inner corners on floors, but not on paths', () => {
    // Joined on all four sides, but not diagonally: four inner corners.
    expect(tilePieces(TILINGS['wood-floor'], 0, 0, joining('n', 'e', 's', 'w'), false)).toHaveLength(5);
    expect(tilePieces(TILINGS['road'], 0, 0, joining('n', 'e', 's', 'w'), false)).toHaveLength(1);
  });

  it('keeps a stepping stone the same wherever it is drawn', () => {
    const a = tilePieces(TILINGS['steppingstone-path'], 5, 9, joining(), false)[0];
    expect(tilePieces(TILINGS['steppingstone-path'], 5, 9, joining('n'), false)[0]).toEqual(a);
  });
});
