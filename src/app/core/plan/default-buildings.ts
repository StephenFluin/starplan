import { findItem, variantsOf } from '../data/catalog';
import { LayoutInfo, TilePoint } from '../data/layout-info';
import { Patch, PlanDocument } from './plan-document';

export interface DefaultBuilding {
  itemId: string;
  /** Footprint top-left. */
  x: number;
  y: number;
}

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
 * The farmhouse, greenhouse, shipping bin and pet bowl every farm starts with, plus whatever else the
 * farm type starts with (the Meadowlands coop), at footprint positions. Layouts store the farmhouse
 * and greenhouse by sprite corner.
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
  for (const item of layout.starter?.objects ?? []) add(item.itemId, item);
  return result;
}

/** Adds the default buildings, and the fences the farm starts with, to an empty document. */
export function addDefaultBuildings(doc: PlanDocument, layout: LayoutInfo): Patch {
  const objects = defaultBuildings(layout)
    .filter((b) => !doc.objectAt(b.x, b.y))
    .map((b) => {
      const obj = { uid: doc.allocateUid(), itemId: b.itemId, x: b.x, y: b.y };
      return { uid: obj.uid, before: null, after: obj };
    });
  const tiles = (layout.starter?.tiles ?? [])
    .filter((t) => findItem(t.itemId) && !doc.tileAt(t.x, t.y))
    .map((t) => ({ x: t.x, y: t.y, before: null, after: findItem(t.itemId)!.id }));
  return { tiles, objects };
}
