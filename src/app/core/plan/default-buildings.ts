import { findItem, variantsOf } from '../data/catalog';
import { LayoutInfo, TilePoint } from '../data/layout-info';
import { PlanDocument } from './plan-document';
import { RestrictionMap } from './restriction-map';

export interface DefaultBuilding {
  itemId: string;
  /** Footprint top-left. */
  x: number;
  y: number;
}

/** Tiles either side of a default building where moving it sideways is allowed. */
const SIDE_ROOM = 3;

/**
 * Rows between the v2 planner's sprite corner and the game footprint, for items the v2 planner
 * (and our v1 plans and layout data) stored by sprite corner. Everything else used its footprint.
 */
const LEGACY_SPRITE_OFFSETS = new Map<string, number>([
  ...variantsOf('house').map((item) => [item.id, 4] as const),
  ...variantsOf('greenhouse').map((item) => [item.id, 4] as const),
]);

export function legacySpriteOffset(itemId: string): number {
  const item = findItem(itemId);
  return item ? (LEGACY_SPRITE_OFFSETS.get(item.id) ?? 0) : 0;
}

/**
 * The farmhouse, greenhouse, shipping bin and pet bowl every farm starts with, at footprint positions.
 * Layout positions for the farmhouse and greenhouse come from the v2 planner (sprite corners).
 */
export function defaultBuildings(layout: LayoutInfo): DefaultBuilding[] {
  const result: DefaultBuilding[] = [];
  const add = (itemId: string, at: TilePoint | undefined) => {
    if (at && findItem(itemId)) result.push({ itemId, x: at.x, y: at.y + legacySpriteOffset(itemId) });
  };
  add('house', layout.house);
  add('greenhouse', layout.greenhouse);
  add('shipping-bin', layout.shippingBin);
  add('pet-bowl', layout.petBowl);
  return result;
}

/** Rows in front of a default building that the v2 data reserves as its doorstep. */
const DOORSTEP_ROWS = 2;

/**
 * The v2 restriction data blocks the default buildings' spots because the buildings stood there:
 * the footprint, the row just behind a roofed building (under the back wall) and the doorstep in
 * front of it. Opens those spots (and anything painted into the background that is now an object),
 * and makes room to shift the farmhouse and greenhouse a few tiles sideways.
 */
export function openDefaultSpots(map: RestrictionMap, layout: LayoutInfo): void {
  for (const building of defaultBuildings(layout)) {
    const item = findItem(building.itemId);
    if (!item) continue;
    // Behind the pet bowl is a fence, so only roofed buildings get the row behind them.
    const behind = legacySpriteOffset(item.id) > 0 ? 1 : 0;
    map.openArea(building.x, building.y - behind, item.width, item.height + behind);
    // Doorsteps are walkable ground; only their "not buildable" mark is a leftover.
    map.allowBuildingIn(building.x, building.y + item.height, item.width, DOORSTEP_ROWS);
    if (item.category === 'buildings' && item.width > 2) {
      map.allowBuildingIn(building.x - SIDE_ROOM, building.y, item.width + SIDE_ROOM * 2, item.height);
    }
  }
  for (const area of layout.baked?.cover ?? []) map.openBlocked(area.x, area.y, area.width, area.height);
}

/** Adds the default buildings to an empty document. */
export function addDefaultBuildings(doc: PlanDocument, layout: LayoutInfo) {
  return defaultBuildings(layout)
    .filter((b) => !doc.objectAt(b.x, b.y))
    .map((b) => {
      const obj = { uid: doc.allocateUid(), itemId: b.itemId, x: b.x, y: b.y };
      return { uid: obj.uid, before: null, after: obj };
    });
}
