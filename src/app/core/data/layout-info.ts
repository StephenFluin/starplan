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

/**
 * Things painted into the background image that should really be movable objects
 * (farmhouse foundation, mailbox, shipping bin). They are hidden by tiling a clean ground
 * sample over them, and recreated as objects.
 */
export interface BakedFeatures {
  /** Top-left tile of a clean 2x2 patch of ground to tile over the covered areas. */
  groundSample: TilePoint;
  cover: readonly TileArea[];
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
  baked?: BakedFeatures;
}
