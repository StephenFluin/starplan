export interface TilePoint {
  x: number;
  y: number;
}

export type LayoutKind = 'farm' | 'interior' | 'community';

export interface TileArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An area of the background to hide under ground tiled from a 2x2 sample. */
export interface BakedCover extends TileArea {
  /** Top-left tile of the ground sample, when not the layout's default one. */
  ground?: TilePoint;
}

/**
 * Things painted into the background image that should really be movable objects
 * (farmhouse foundation, mailbox, shipping bin, greenhouse foundation, pet bowl). They are hidden
 * by tiling a clean ground sample over them, and recreated as objects.
 */
export interface BakedFeatures {
  /** Top-left tile of a clean 2x2 patch of ground to tile over the covered areas. */
  groundSample: TilePoint;
  cover: readonly BakedCover[];
  /**
   * Top-left tile of the 3x2 stone path painted in front of the greenhouse door. It is drawn as
   * part of the greenhouse so it moves with it.
   */
  greenhouseDoorstep?: TilePoint;
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
  baked?: BakedFeatures;
}
