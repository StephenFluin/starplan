import { CATALOG, CatalogItem, findItem, variantsOf } from '../data/catalog';
import { LayoutInfo } from '../data/layout-info';
import { defaultBuildings } from './default-buildings';
import { SavedPlan } from './serialize';

/** A farm read from a Stardew Valley save file. */
export interface SaveImport {
  plan: SavedPlan;
  /** "Bopper Farm". */
  name: string;
  /** What was left out, by name, with counts. */
  skipped: ReadonlyMap<string, number>;
}

export type SaveImportError =
  /** Not a save file (or not one this planner can read). */
  | 'not-a-save'
  /** The save's SaveGameInfo file, which only has the player in it. */
  | 'save-info'
  /** A farm type the planner has no map for (a mod's farm). */
  | 'unknown-farm';

/** whichFarm in a save, in order. 7 is a mod's farm; the Meadowlands Farm is the only one we know. */
const FARM_TYPES = ['regular', 'fishing', 'foraging', 'mining', 'combat', 'fourcorners', 'beach'];

/** Harvest item id (Data/Crops.json HarvestItemId) to crop. */
const CROPS: Readonly<Record<string, string>> = {
  '24': 'parsnip', '188': 'green-bean', '190': 'cauliflower', '192': 'potato', '248': 'garlic', '271': 'rice',
  '830': 'taro-root', '250': 'kale', '252': 'rhubarb', '400': 'strawberry', '254': 'melon', '256': 'tomato',
  '258': 'blueberry', '260': 'hot-pepper', '262': 'wheat', '264': 'radish', '266': 'red-cabbage', '268': 'starfruit',
  '832': 'pineapple', '433': 'coffee-bean', '270': 'corn', '304': 'hops', '398': 'grape', '300': 'amaranth',
  '272': 'eggplant', '274': 'artichoke', '276': 'pumpkin', '278': 'bok-choy', '280': 'yam', '282': 'cranberry',
  '284': 'beet', '454': 'ancient-fruit', '591': 'tulip', '597': 'blue-jazz', '376': 'poppy', '593': 'summer-spangle',
  '421': 'sunflower', '595': 'fairy-rose', '417': 'sweet-gem-berry', '771': 'fiber', '889': 'qi-fruit',
  Carrot: 'carrot', SummerSquash: 'summer-squash', Broccoli: 'broccoli', Powdermelon: 'powdermelon',
};

/** Wild seeds, by seed item id: their harvest is random, so they're recognised by the seed. */
const WILD_SEEDS: Readonly<Record<string, string>> = { '495': 'spring-seeds', '496': 'summer-seeds', '497': 'fall-seeds', '498': 'winter-seeds' };

/** Fruit trees by sapling id (Data/FruitTrees.json, 1.6 saves) and by fruit id (older saves). */
const FRUIT_TREES: Readonly<Record<string, string>> = {
  '628': 'cherry-tree', '629': 'apricot', '630': 'orange-tree', '631': 'peach', '632': 'pomegranate', '633': 'apple',
  '69': 'banana-tree', '835': 'mango-tree',
  '638': 'cherry-tree', '634': 'apricot', '635': 'orange-tree', '636': 'peach', '637': 'pomegranate', '613': 'apple',
  '91': 'banana-tree', '834': 'mango-tree',
};

/** Wild trees by treeType (Data/WildTrees.json). */
const WILD_TREES: Readonly<Record<string, string>> = {
  '1': 'oak-tree', '2': 'maple-tree', '3': 'pine-tree', '6': 'palm-tree', '7': 'mushroom-tree', '8': 'mahogany-tree',
  '9': 'island-palm-tree', '10': 'mossy-oak-tree', '11': 'mossy-maple-tree', '12': 'mossy-pine-tree', '13': 'mystic-tree',
};

/** Floors and paths by whichFloor (Data/FloorsAndPaths.json). */
const FLOORS = [
  'wood-floor', 'stone-floor', 'weathered-floor', 'crystal-floor', 'straw-floor', 'gravel-path', 'wood-path', 'crystal-path',
  'road', 'steppingstone-path', 'brick-floor', 'rustic-plank-floor', 'stone-walkway',
];

/** Resource clumps by parentSheetIndex: stumps, logs, boulders (the Hill-top Farm's too) and meteorites. */
const CLUMPS: Readonly<Record<string, string>> = {
  '600': 'large-stump', '602': 'large-log', '672': 'large-rock', '622': 'meteorite',
  '752': 'large-rock', '754': 'large-rock', '756': 'large-rock', '758': 'large-rock',
};

/** Giant crops by their crop's harvest item id. */
const GIANT_CROPS: Readonly<Record<string, string>> = {
  '190': 'giant-cauliflower', '254': 'giant-melon', '276': 'giant-pumpkin', Powdermelon: 'giant-powdermelon', '889': 'giant-qi-fruit',
};

/** Big craftables whose names don't say which item they are. */
const BIG_CRAFTABLES: Readonly<Record<string, string>> = {
  '110': 'rarecrow-1', '113': 'rarecrow-2', '126': 'rarecrow-3', '136': 'rarecrow-4', '137': 'rarecrow-5',
  '138': 'rarecrow-6', '139': 'rarecrow-7', '140': 'rarecrow-8',
  '130': 'chest', '232': 'stone-chest', BigChest: 'big-chest', BigStoneChest: 'big-stone-chest',
};

/** What weeds, stones, twigs and the like are counted as when left out. */
const DEBRIS = 'Weeds, stones and twigs';
const DEBRIS_NAMES = new Set(['Weeds', 'Stone', 'Twig', 'Artifact Spot', 'Seed Spot']);

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_NAME = new Map(CATALOG.filter((item) => item.category !== 'crops').map((item) => [normalize(item.name), item]));

const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

function child(el: Element | null | undefined, tag: string): Element | null {
  if (!el) return null;
  for (const c of el.children) if (c.tagName === tag) return c;
  return null;
}

function text(el: Element | null | undefined, tag: string): string | null {
  return child(el, tag)?.textContent?.trim() ?? null;
}

function xsiType(el: Element): string | null {
  return el.getAttributeNS(XSI, 'type') ?? el.getAttribute('xsi:type');
}

/** The entries of a serialized dictionary keyed by tile: [x, y, value element]. */
function* byTile(el: Element | null): Generator<[number, number, Element]> {
  for (const item of el?.children ?? []) {
    const vector = child(child(item, 'key'), 'Vector2');
    const value = child(item, 'value')?.firstElementChild;
    if (vector && value) yield [Number(text(vector, 'X')), Number(text(vector, 'Y')), value];
  }
}

/**
 * Reads the farm from a Stardew Valley save file (the file named like the save's folder, e.g.
 * Saves/Bopper_439192830/Bopper_439192830): its buildings, machines and other objects, fences,
 * floors, crops, trees and resource clumps, as a plan for the matching farm map. Weeds, stones,
 * twigs and things the planner has no item for are left out and counted.
 */
export function importSave(xml: string, layouts: readonly LayoutInfo[]): SaveImport | SaveImportError {
  const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
  if (root.tagName === 'Farmer') return 'save-info';
  if (root.tagName !== 'SaveGame') return 'not-a-save';
  const player = child(root, 'player');
  const farm = [...(child(root, 'locations')?.children ?? [])].find((loc) => text(loc, 'name') === 'Farm');
  if (!farm) return 'not-a-save';

  const whichFarm = Number(text(root, 'whichFarm') ?? 0);
  const layoutId = whichFarm === 7 ? (child(root, 'whichModFarm')?.textContent?.includes('Meadowlands') ? 'ranching' : null) : FARM_TYPES[whichFarm];
  const layout = layouts.find((l) => l.id === layoutId);
  if (!layout) return 'unknown-farm';

  const skipped = new Map<string, number>();
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1);
  const tiles = new Map<string, string>();
  const objects: [string, number, number][] = [];
  const occupied = new Set<string>();
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < layout.width && y < layout.height;

  /** Adds an object unless it would overlap one already added. */
  const place = (item: CatalogItem, x: number, y: number, what = item.name): boolean => {
    const cells: string[] = [];
    for (let ty = y; ty < y + item.height; ty++) {
      for (let tx = x; tx < x + item.width; tx++) {
        if (!inside(tx, ty) || occupied.has(`${tx},${ty}`)) {
          skip(`${what} (overlapping)`);
          return false;
        }
        cells.push(`${tx},${ty}`);
      }
    }
    for (const cell of cells) occupied.add(cell);
    objects.push([item.id, x, y]);
    return true;
  };
  const paint = (itemId: string, x: number, y: number) => {
    if (inside(x, y) && !tiles.has(`${x},${y}`)) tiles.set(`${x},${y}`, itemId);
  };

  // Buildings first: they're what the rest of the farm is laid out around.
  const houseLevel = Number(text(player, 'houseUpgradeLevel') ?? 0);
  const house = variantsOf('house')[Math.min(houseLevel, 2)];
  const mail = new Set([...(child(player, 'mailReceived')?.children ?? [])].map((m) => m.textContent));
  const greenhouseFixed = text(farm, 'greenhouseUnlocked') === 'true' || mail.has('ccPantry') || mail.has('jojaPantry');
  const greenhouse = findItem(greenhouseFixed ? 'greenhouse-fixed' : 'greenhouse')!;
  const families = new Set<string>();
  for (const building of child(farm, 'buildings')?.children ?? []) {
    const type = text(building, 'buildingType') ?? '';
    const skin = text(building, 'skinId');
    const item =
      type === 'Farmhouse' ? house
      : type === 'Greenhouse' ? greenhouse
      : BY_NAME.get(normalize(skin || (type === 'Cabin' ? 'Stone Cabin' : type)));
    if (!item) {
      skip(type);
      continue;
    }
    if (place(item, Number(text(building, 'tileX')), Number(text(building, 'tileY')))) families.add(variantsOf(item.id)[0]?.id ?? item.id);
  }
  // Older saves leave out buildings that were part of the map then.
  for (const spot of defaultBuildings(layout)) {
    const family = variantsOf(spot.itemId)[0]?.id ?? spot.itemId;
    if (!['house', 'greenhouse', 'shipping-bin', 'pet-bowl'].includes(family) || families.has(family)) continue;
    const item = family === 'house' ? house : family === 'greenhouse' ? greenhouse : findItem(spot.itemId)!;
    place(item, spot.x, spot.y);
  }

  const terrain = [...byTile(child(farm, 'terrainFeatures'))];
  const treeTiles = new Set(terrain.filter(([, , f]) => /Tree$/.test(xsiType(f) ?? '')).map(([x, y]) => `${x},${y}`));
  for (const [x, y, obj] of byTile(child(farm, 'objects'))) {
    const name = text(obj, 'name') ?? '';
    const id = text(obj, 'itemId') ?? text(obj, 'parentSheetIndex') ?? '';
    if (DEBRIS_NAMES.has(name) || text(obj, 'type') === 'Litter') {
      skip(DEBRIS);
      continue;
    }
    // A tapper sits on a tree's trunk, which the tree's own tiles cover in the planner.
    if (treeTiles.has(`${x},${y}`)) {
      skip(`${name} (on a tree)`);
      continue;
    }
    const held = text(child(obj, 'heldObject')?.firstElementChild, 'name');
    let item = (text(obj, 'bigCraftable') === 'true' && BIG_CRAFTABLES[id]) ? findItem(BIG_CRAFTABLES[id]) : BY_NAME.get(normalize(name));
    if (item && held === 'Pressure Nozzle') item = BY_NAME.get(normalize(`${name} + Pressure Nozzle`)) ?? item;
    if (item?.category === 'fences' && held === 'Torch') item = BY_NAME.get(normalize(`${name} + Torch`)) ?? item;
    if (!item) skip(name);
    else if (item.kind === 'tile') paint(item.id, x, y);
    else place(item, x, y);
  }

  for (const clump of child(farm, 'resourceClumps')?.children ?? []) {
    const tile = child(clump, 'tile');
    const id = xsiType(clump) === 'GiantCrop' ? GIANT_CROPS[text(clump, 'itemId') ?? text(clump, 'parentSheetIndex') ?? ''] : CLUMPS[text(clump, 'parentSheetIndex') ?? ''];
    const item = id ? findItem(id) : undefined;
    if (item) place(item, Number(text(tile, 'X')), Number(text(tile, 'Y')));
    else skip(xsiType(clump) === 'GiantCrop' ? 'Giant crop' : 'Resource clump');
  }

  // Fruit trees take 3x3 tiles in the planner, with the trunk on the bottom row's middle tile;
  // wild trees take their trunk's tile.
  const fruitTrees: [CatalogItem, number, number][] = [];
  const wildTrees: [CatalogItem, number, number][] = [];
  for (const [x, y, feature] of terrain) {
    switch (xsiType(feature)) {
      case 'Flooring': {
        const floor = FLOORS[Number(text(feature, 'whichFloor'))];
        if (floor) paint(floor, x, y);
        else skip('Floor');
        break;
      }
      case 'Grass':
        paint('grass', x, y);
        break;
      case 'HoeDirt': {
        const crop = child(feature, 'crop');
        if (!crop || !crop.children.length || text(crop, 'dead') === 'true') {
          paint('farmland', x, y);
          break;
        }
        const cropId = WILD_SEEDS[text(crop, 'seedIndex') ?? text(crop, 'netSeedIndex') ?? ''] ?? CROPS[text(crop, 'indexOfHarvest') ?? ''];
        if (cropId && text(crop, 'forageCrop') !== 'true') paint(cropId, x, y);
        else {
          skip('Crop');
          paint('farmland', x, y);
        }
        break;
      }
      case 'Tree': {
        const item = findItem(WILD_TREES[text(feature, 'treeType') ?? ''] ?? '');
        // Seedlings and saplings sprout all over a farm; only grown trees are part of its layout.
        if (item && Number(text(feature, 'growthStage')) >= 5 && text(feature, 'stump') !== 'true') wildTrees.push([item, x, y]);
        break;
      }
      case 'FruitTree': {
        const item = findItem(FRUIT_TREES[text(feature, 'treeId') ?? text(feature, 'indexOfFruit') ?? ''] ?? '');
        if (item && text(feature, 'stump') !== 'true') fruitTrees.push([item, x, y]);
        else if (!item) skip('Fruit tree');
        break;
      }
      case 'Bush':
        // Tea bushes; other bushes are part of the map.
        if (text(feature, 'size') === '3') paint('tea', x, y);
        break;
    }
  }
  for (const feature of child(farm, 'largeTerrainFeatures')?.children ?? []) {
    const tile = child(feature, 'tilePosition');
    if (xsiType(feature) === 'Bush' && text(feature, 'size') === '3') paint('tea', Number(text(tile, 'X')), Number(text(tile, 'Y')));
  }
  // Fruit trees (planted on purpose) get their space before wild ones.
  for (const [item, x, y] of fruitTrees) place(item, x - 1, y - 2);
  for (const [item, x, y] of wildTrees) place(item, x, y);

  const planTiles: Record<string, number[]> = {};
  for (const [cell, itemId] of tiles) {
    const [x, y] = cell.split(',').map(Number);
    (planTiles[itemId] ??= []).push(x, y);
  }
  const farmName = text(player, 'farmName');
  return {
    plan: { v: 5, layout: layout.id, tiles: planTiles, objects, ...(text(farm, 'greenhouseMoved') === 'true' && { greenhouseMoved: true as const }) },
    name: farmName ? `${farmName} Farm` : 'Imported farm',
    skipped,
  };
}
