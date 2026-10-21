import { findItem } from '../data/catalog';
import { GroundEffect } from '../data/game-art';
import { PlanDocument } from './plan-document';
import { IMPASSABLE, NOT_BUILDABLE, NOT_TILLABLE, RestrictionMap } from './restriction-map';

/**
 * The farm's restrictions as the buildings on it change them (BuildingRules.ground): the greenhouse
 * makes the ground around it buildable but untillable and its doorstep unbuildable, and the
 * farmhouse's mailbox is solid. Where buildings' areas overlap, the first building's wins.
 * Objects in `ignore` (being moved) change nothing, as a moving building doesn't in the game.
 */
export function restrictionsWithBuildings(
  ground: RestrictionMap,
  doc: PlanDocument,
  ignore: ReadonlySet<number> = new Set(),
): RestrictionMap {
  const changed = new Map<number, readonly [number, number, number]>();
  for (const obj of doc.allObjects()) {
    if (ignore.has(obj.uid)) continue;
    for (const effect of findItem(obj.itemId)?.building?.ground ?? []) {
      for (let y = obj.y + effect.y; y < obj.y + effect.y + effect.height; y++) {
        for (let x = obj.x + effect.x; x < obj.x + effect.x + effect.width; x++) {
          const cell = y * ground.width + x;
          if (ground.inBounds(x, y) && !changed.has(cell))
            changed.set(cell, [x, y, withEffect(ground.bits(x, y), effect)]);
        }
      }
    }
  }
  return changed.size ? ground.withTiles(changed.values()) : ground;
}

function withEffect(bits: number, effect: GroundEffect): number {
  if (effect.solid) return IMPASSABLE | NOT_BUILDABLE | NOT_TILLABLE;
  // Nothing makes impassable ground (water, cliffs) buildable.
  if (effect.buildable === true && !(bits & IMPASSABLE)) bits &= ~NOT_BUILDABLE;
  if (effect.buildable === false) bits |= NOT_BUILDABLE;
  if (effect.tillable === false) bits |= NOT_TILLABLE;
  return bits;
}
