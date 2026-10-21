import { Tiling } from '../../../core/data/game-art';

/** A piece of a sheet to draw for a tile: where in the sheet, and where relative to the tile's top-left. */
export interface TilePiece {
  file: string;
  sx: number;
  sy: number;
  width: number;
  height: number;
  dx: number;
  dy: number;
}

/** Which neighbours join a tile, by offset: up, right, down, left and the diagonals. */
export type Joins = (dx: number, dy: number) => boolean;

/** Fence.fenceDrawGuide: the piece for each sum of joined neighbours (right 100, left 10, down 500, up 1000). */
const FENCE_GUIDE: Readonly<Record<number, number>> = {
  0: 5,
  10: 9,
  100: 10,
  1000: 3,
  500: 5,
  1010: 8,
  1100: 6,
  1500: 3,
  600: 0,
  510: 2,
  110: 7,
  1600: 0,
  1610: 4,
  1510: 2,
  1110: 7,
  610: 4,
};

/** Flooring.drawGuide: the piece (16 per sheet row) for each mask of joined sides (N 1, E 2, S 4, W 8). */
const FLOOR_GUIDE: Readonly<Record<number, number>> = {
  0: 0,
  6: 1,
  14: 2,
  12: 3,
  4: 16,
  7: 17,
  15: 18,
  13: 19,
  5: 32,
  3: 33,
  11: 34,
  9: 35,
  1: 48,
  2: 49,
  10: 50,
  8: 51,
};
const FLOOR_PIECES = Object.values(FLOOR_GUIDE);

/** A fence piece's sum of joined neighbours. */
export function fenceSum(joins: Joins): number {
  return (
    (joins(1, 0) ? 100 : 0) +
    (joins(-1, 0) ? 10 : 0) +
    (joins(0, 1) ? 500 : 0) +
    (joins(0, -1) ? 1000 : 0)
  );
}

/**
 * The pieces a fence or floor tile is drawn with, given which neighbours join it, as the game draws
 * them: a 16x32 fence piece standing one tile up; a floor's 16x16 piece, plus (for floors that fill
 * them) small pieces in inner corners where two sides join but the diagonal between them doesn't.
 * Stepping stones pick a piece at random, here by the tile's position so it stays put.
 */
export function tilePieces(
  tiling: Tiling,
  x: number,
  y: number,
  joins: Joins,
  winter: boolean,
): TilePiece[] {
  if (tiling.kind === 'fence') {
    const index = FENCE_GUIDE[fenceSum(joins)];
    const columns = 3;
    return [
      {
        file: tiling.file,
        sx: (index % columns) * 16,
        sy: Math.floor(index / columns) * 32,
        width: 16,
        height: 32,
        dx: 0,
        dy: -16,
      },
    ];
  }
  const file = winter ? tiling.winterFile : tiling.file;
  const corner = winter ? tiling.winterCorner : tiling.corner;
  const mask =
    (joins(0, -1) ? 1 : 0) | (joins(1, 0) ? 2 : 0) | (joins(0, 1) ? 4 : 0) | (joins(-1, 0) ? 8 : 0);
  const index =
    tiling.connect === 'random'
      ? FLOOR_PIECES[positionHash(x, y) % FLOOR_PIECES.length]
      : FLOOR_GUIDE[mask];
  const pieces: TilePiece[] = [
    {
      file,
      sx: corner.x + (index % 16) * 16,
      sy: corner.y + Math.floor(index / 16) * 16,
      width: 16,
      height: 16,
      dx: 0,
      dy: 0,
    },
  ];
  if (tiling.connect === 'default' || tiling.connect === 'decorated') {
    const size = tiling.cornerSize;
    const inner = (sides: number, dx: number, dy: number) =>
      (mask & sides) === sides && !joins(dx, dy);
    const piece = (sx: number, sy: number, dx: number, dy: number) =>
      pieces.push({
        file,
        sx: corner.x + sx,
        sy: corner.y + sy,
        width: size,
        height: size,
        dx,
        dy,
      });
    if (inner(1 | 8, -1, -1)) piece(64 - size, 48 - size, 0, 0);
    if (inner(1 | 2, 1, -1)) piece(16, 48 - size, 16 - size, 0);
    if (inner(4 | 2, 1, 1)) piece(16, 0, 16 - size, 16 - size);
    if (inner(4 | 8, -1, 1)) piece(64 - size, 0, 0, 16 - size);
  }
  return pieces;
}

/** A stable pseudo-random number for a tile. */
function positionHash(x: number, y: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
