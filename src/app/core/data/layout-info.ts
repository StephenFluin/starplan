import { MapSeason } from './game-art';

export interface TilePoint {
  x: number;
  y: number;
}

export type LayoutKind = 'farm' | 'interior' | 'community';

/** Something the game places when a farm is created, like the Meadowlands coop and its fences. */
export interface StarterItem {
  itemId: string;
  x: number;
  y: number;
}

/**
 * Sand the game lays over the greenhouse's start location once the greenhouse has first moved
 * (Farm.ClearGreenhouseGrassTiles), clearing the grass patch the base map has under it.
 */
export interface GreenhouseDirt {
  /** Image file name under assets/layouts. */
  image: string;
  /** Top-left tile: the greenhouse's start location. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Restrictions inside the patch, run-length encoded like the layout's own. */
  restrictions: string;
}

export interface LayoutInfo {
  id: string;
  name: string;
  /** Background image file name under assets/layouts. */
  image: string;
  /** Size in tiles. */
  width: number;
  height: number;
  kind: LayoutKind;
  /**
   * Whether summer, fall and winter versions of the image (and of the greenhouse's dirt patch)
   * exist beside it, named <image>-<season>.png.
   */
  seasonal?: boolean;
  /** Whether a restriction mask exists under assets/restrictions. */
  restrictions: boolean;
  author?: string;
  url?: string;
  house?: TilePoint;
  greenhouse?: TilePoint;
  shippingBin?: TilePoint;
  petBowl?: TilePoint;
  greenhouseDirt?: GreenhouseDirt;
  /** Objects and tiles (fences) the farm starts with, besides the default buildings. */
  starter?: { objects: readonly StarterItem[]; tiles: readonly StarterItem[] };
}

/** A layout file (its map image, or the greenhouse's dirt patch) in a season's look, where it has one. */
export function seasonalImage(layout: LayoutInfo, file: string, season: MapSeason): string {
  return layout.seasonal && season !== 'spring' ? file.replace(/(\.\w+)$/, `-${season}$1`) : file;
}
