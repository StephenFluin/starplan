/** The seasons a farm can be shown in. Spring is the default look. */
export type MapSeason = 'spring' | 'summer' | 'fall' | 'winter';

/** Files for the seasons other than spring, where the art changes with them. */
export type SeasonalFiles = Partial<Record<Exclude<MapSeason, 'spring'>, string>>;

/** Art for an item, cropped from the game's own content (see scripts/import-game.mts). */
export interface GameArt {
  /** File name under assets/game: the spring look. */
  file: string;
  seasons?: SeasonalFiles;
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

/** Tiles relative to a building's footprint top-left corner. */
export interface TileArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a building changes the ground in an area: buildable or not, untillable, or solid. */
export interface GroundEffect extends TileArea {
  buildable?: boolean;
  tillable?: false;
  solid?: true;
}

/**
 * How a building sits on the farm, from the game's building data (Data/Buildings.json) and code.
 * Tile positions are relative to the footprint's top-left corner.
 */
export interface BuildingRules {
  /** The door people use. The tile below it must be buildable or a path. */
  door?: { x: number; y: number };
  /** Tiles beyond the footprint that must be free too: buildable, or only passable. */
  placementTiles?: readonly (TileArea & { passableOnly: boolean })[];
  /** Whether floors stay under the building. The rest of the ground it covers is cleared. */
  floorsUnderneath: boolean;
  /** How the building changes the ground around it. Where areas overlap, the first one wins. */
  ground?: readonly GroundEffect[];
  /**
   * Art the game draws on the ground under the building, below floors (the greenhouse's shadow and
   * doorstep, the pet bowl's platform). In pixels from the footprint's top-left corner.
   */
  background?: { file: string; seasons?: SeasonalFiles; x: number; y: number; width: number; height: number };
}
