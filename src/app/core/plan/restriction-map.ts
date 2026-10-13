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

  /** Clears every restriction in an area, e.g. a spot only blocked because a default building stood there. */
  openArea(x: number, y: number, width: number, height: number): void {
    this.forEachIn(x, y, width, height, (i) => (this.cells[i] = 0));
  }

  /**
   * Clears every restriction on the tiles in an area that are impassable or unbuildable, e.g. where
   * something painted into the background stood. Open ground there keeps its tillability.
   */
  openBlocked(x: number, y: number, width: number, height: number): void {
    this.forEachIn(x, y, width, height, (i) => {
      if (this.cells[i] & (IMPASSABLE | NOT_BUILDABLE)) this.cells[i] = 0;
    });
  }

  /** Makes the passable tiles in an area buildable; impassable terrain stays blocked. */
  allowBuildingIn(x: number, y: number, width: number, height: number): void {
    this.forEachIn(x, y, width, height, (i) => {
      if ((this.cells[i] & IMPASSABLE) === 0) this.cells[i] &= ~NOT_BUILDABLE;
    });
  }

  private forEachIn(x: number, y: number, width: number, height: number, fn: (index: number) => void): void {
    for (let ty = Math.max(0, y); ty < Math.min(this.height, y + height); ty++) {
      for (let tx = Math.max(0, x); tx < Math.min(this.width, x + width); tx++) fn(ty * this.width + tx);
    }
  }

  /** Raw restriction bits for a tile (0 when out of bounds). */
  bits(x: number, y: number): number {
    return this.inBounds(x, y) ? this.cells[y * this.width + x] : 0;
  }
}
