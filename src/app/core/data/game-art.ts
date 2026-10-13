/** Art for an item, cropped from the game's own content (see scripts/import-game.mts). */
export interface GameArt {
  /** File name under assets/game. */
  file: string;
  /** Sprite size in pixels. */
  width: number;
  height: number;
  /** Pixel offset from the footprint's bottom-left corner, as the game draws it. */
  offsetX: number;
  offsetY: number;
  /** Footprint in tiles, from the game's data. */
  footprint: { width: number; height: number };
}

/** A sprite that is drawn as part of another item (e.g. the farmhouse's mailbox). */
export interface GameSprite {
  file: string;
  width: number;
  height: number;
}
