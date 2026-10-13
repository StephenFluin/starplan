import { Restriction } from '../data/catalog';

export const IMPASSABLE = 1;
export const NOT_BUILDABLE = 2;
export const NOT_TILLABLE = 4;

const BIT_FOR: Record<Restriction, number> = {
  accessible: IMPASSABLE,
  buildable: NOT_BUILDABLE,
  tillable: NOT_TILLABLE,
};

/** Per-tile placement restrictions for a layout. */
export class RestrictionMap {
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly cells: Uint8Array,
  ) {}

  /** A map with no restrictions inside its bounds. */
  static open(width: number, height: number): RestrictionMap {
    return new RestrictionMap(width, height, new Uint8Array(width * height));
  }

  /** Decodes the run-length format written by scripts/import-v2.mts: "<count><letter>" with a=0. */
  static decode(width: number, height: number, encoded: string): RestrictionMap {
    const cells = new Uint8Array(width * height);
    let index = 0;
    for (const match of encoded.matchAll(/(\d+)([a-h])/g)) {
      const run = Number(match[1]);
      const value = match[2].charCodeAt(0) - 97;
      cells.fill(value, index, Math.min(index + run, cells.length));
      index += run;
    }
    return new RestrictionMap(width, height, cells);
  }

  /** A copy with an area's restrictions replaced, e.g. by a map patch laid over it. */
  withArea(x: number, y: number, width: number, height: number, encoded: string): RestrictionMap {
    const area = RestrictionMap.decode(width, height, encoded);
    const cells = this.cells.slice();
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        if (this.inBounds(x + tx, y + ty)) cells[(y + ty) * this.width + x + tx] = area.bits(tx, ty);
      }
    }
    return new RestrictionMap(this.width, this.height, cells);
  }

  /** A copy with some tiles' bits replaced. */
  withTiles(tiles: Iterable<readonly [x: number, y: number, bits: number]>): RestrictionMap {
    const cells = this.cells.slice();
    for (const [x, y, bits] of tiles) {
      if (this.inBounds(x, y)) cells[y * this.width + x] = bits;
    }
    return new RestrictionMap(this.width, this.height, cells);
  }

  /** Whether another map has the same size and restrictions. */
  equals(other: RestrictionMap): boolean {
    return this.width === other.width && this.height === other.height && this.cells.every((bits, i) => bits === other.cells[i]);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** True when the tile can't hold something with the given restriction. Out of bounds is always blocked. */
  isBlocked(x: number, y: number, restriction: Restriction): boolean {
    if (!this.inBounds(x, y)) {
      return true;
    }
    return (this.cells[y * this.width + x] & BIT_FOR[restriction]) !== 0;
  }

  /** Raw restriction bits for a tile (0 when out of bounds). */
  bits(x: number, y: number): number {
    return this.inBounds(x, y) ? this.cells[y * this.width + x] : 0;
  }
}
