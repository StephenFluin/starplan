import { findItem } from '../../core/data/catalog';
import { PlacementFailure } from '../../core/plan/placement';

/** Tells the user why something didn't fit, e.g. "Coop doesn't fit there: Keg is in the way." */
export function blockedMessage({ itemId, reason }: PlacementFailure): string {
  const name = (id: string) => findItem(id)?.name ?? id;
  const item = name(itemId);
  switch (reason.kind) {
    case 'outside':
      return `${item} would go off the map.`;
    case 'ground':
      if (reason.restriction === 'accessible') return `${item} can't go on water, cliffs or walls.`;
      return `${item} needs ${reason.restriction} ground there. View & options can show where that is.`;
    case 'object':
    case 'tile':
      return `${item} doesn't fit there: ${name(reason.itemId)} is in the way.`;
    case 'door':
      return `${item} needs buildable ground or a path in front of its door.`;
    case 'clearance':
      return `${item} needs the red tiles next to it clear.`;
  }
}
