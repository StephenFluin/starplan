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
