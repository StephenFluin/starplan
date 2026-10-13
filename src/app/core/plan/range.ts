import { RangeShape } from '../data/catalog';

/**
 * Tiles covered by a range around an object placed at (x, y).
 * Shapes follow the in-game rules: sprinklers and bee houses use manhattan or
 * chebyshev distance, scarecrows use euclidean distance (< radius + 1).
 */
export function rangeTiles(range: RangeShape, x: number, y: number): [number, number][] {
  const cx = x + (range.origin?.x ?? 0);
  const cy = y + (range.origin?.y ?? 0);
  const r = range.radius;
  const tiles: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0 && !range.includeCenter) continue;
      if (inRange(range, dx, dy)) tiles.push([cx + dx, cy + dy]);
    }
  }
  return tiles;
}

function inRange(range: RangeShape, dx: number, dy: number): boolean {
  switch (range.shape) {
    case 'diamond':
      return Math.abs(dx) + Math.abs(dy) <= range.radius;
    case 'square':
      return true;
    case 'circle':
      return Math.hypot(dx, dy) < range.radius + 1;
  }
}
