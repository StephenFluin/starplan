import { FARM_LAYOUTS } from './farms.generated';
import { LayoutInfo } from './layout-info';
import { V2_LAYOUTS } from './layouts.generated';

/** Every layout: the game's farms first, then interiors and other maps from the v2 planner. */
export const LAYOUTS: readonly LayoutInfo[] = [...FARM_LAYOUTS, ...V2_LAYOUTS];
