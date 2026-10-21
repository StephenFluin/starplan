import { CATALOG, CatalogItem, findItem, variantsOf } from '../data/catalog';
import { LayoutInfo } from '../data/layout-info';
import { defaultBuildings } from './default-buildings';
import { SavedPlan } from './serialize';

/** A place read from a Stardew Valley save file, as a plan. */
export interface ImportedPlan {
  plan: SavedPlan;
  /** "Bopper Farm", "Bopper Farm: Big Shed". */
  name: string;
  /** What was left out, by name, with counts. */
  skipped: ReadonlyMap<string, number>;
}

/** A farm read from a save, and the insides of its greenhouse, sheds, barns and coops. */
export interface SaveImport extends ImportedPlan {
  interiors: ImportedPlan[];
}

/** Interior maps by the building they're inside, matching the game's own maps tile for tile. */
const INTERIORS: Readonly<Record<string, string>> = {
  Shed: 'shed',
  'Big Shed': 'shed-big',
  Barn: 'barn',
  'Big Barn': 'barn-big',
  'Deluxe Barn': 'barn-deluxe',
  Coop: 'coop',
  'Big Coop': 'coop-big',
  'Deluxe Coop': 'coop-deluxe',
};

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
  '24': 'parsnip',
  '188': 'green-bean',
  '190': 'cauliflower',
  '192': 'potato',
  '248': 'garlic',
  '271': 'rice',
  '830': 'taro-root',
  '250': 'kale',
  '252': 'rhubarb',
  '400': 'strawberry',
  '254': 'melon',
  '256': 'tomato',
  '258': 'blueberry',
  '260': 'hot-pepper',
  '262': 'wheat',
  '264': 'radish',
  '266': 'red-cabbage',
  '268': 'starfruit',
  '832': 'pineapple',
  '433': 'coffee-bean',
  '270': 'corn',
  '304': 'hops',
  '398': 'grape',
  '300': 'amaranth',
  '272': 'eggplant',
  '274': 'artichoke',
  '276': 'pumpkin',
  '278': 'bok-choy',
  '280': 'yam',
  '282': 'cranberry',
  '284': 'beet',
  '454': 'ancient-fruit',
  '591': 'tulip',
  '597': 'blue-jazz',
  '376': 'poppy',
  '593': 'summer-spangle',
  '421': 'sunflower',
  '595': 'fairy-rose',
  '417': 'sweet-gem-berry',
  '771': 'fiber',
  '889': 'qi-fruit',
  Carrot: 'carrot',
  SummerSquash: 'summer-squash',
  Broccoli: 'broccoli',
  Powdermelon: 'powdermelon',
};

/** Wild seeds, by seed item id: their harvest is random, so they're recognised by the seed. */
const WILD_SEEDS: Readonly<Record<string, string>> = {
  '495': 'spring-seeds',
  '496': 'summer-seeds',
  '497': 'fall-seeds',
  '498': 'winter-seeds',
};

/** Fruit trees by sapling id (Data/FruitTrees.json, 1.6 saves) and by fruit id (older saves). */
const FRUIT_TREES: Readonly<Record<string, string>> = {
  '628': 'cherry-tree',
  '629': 'apricot',
  '630': 'orange-tree',
  '631': 'peach',
  '632': 'pomegranate',
  '633': 'apple',
  '69': 'banana-tree',
  '835': 'mango-tree',
  '638': 'cherry-tree',
  '634': 'apricot',
  '635': 'orange-tree',
  '636': 'peach',
  '637': 'pomegranate',
  '613': 'apple',
  '91': 'banana-tree',
  '834': 'mango-tree',
};

/** Wild trees by treeType (Data/WildTrees.json). */
const WILD_TREES: Readonly<Record<string, string>> = {
  '1': 'oak-tree',
  '2': 'maple-tree',
  '3': 'pine-tree',
  '6': 'palm-tree',
  '7': 'mushroom-tree',
  '8': 'mahogany-tree',
  '9': 'island-palm-tree',
  '10': 'mossy-oak-tree',
  '11': 'mossy-maple-tree',
  '12': 'mossy-pine-tree',
  '13': 'mystic-tree',
};

/** Floors and paths by whichFloor (Data/FloorsAndPaths.json). */
const FLOORS = [
  'wood-floor',
  'stone-floor',
  'weathered-floor',
  'crystal-floor',
  'straw-floor',
  'gravel-path',
  'wood-path',
  'crystal-path',
  'road',
  'steppingstone-path',
  'brick-floor',
  'rustic-plank-floor',
  'stone-walkway',
];

/** Resource clumps by parentSheetIndex: stumps, logs, boulders (the Hill-top Farm's too) and meteorites. */
const CLUMPS: Readonly<Record<string, string>> = {
  '600': 'large-stump',
  '602': 'large-log',
  '672': 'large-rock',
  '622': 'meteorite',
  '752': 'large-rock',
  '754': 'large-rock',
  '756': 'large-rock',
  '758': 'large-rock',
};

/** Giant crops by their crop's harvest item id. */
const GIANT_CROPS: Readonly<Record<string, string>> = {
  '190': 'giant-cauliflower',
  '254': 'giant-melon',
  '276': 'giant-pumpkin',
  Powdermelon: 'giant-powdermelon',
  '889': 'giant-qi-fruit',
};

/** Big craftables whose names don't say which item they are. */
const BIG_CRAFTABLES: Readonly<Record<string, string>> = {
  '110': 'rarecrow-1',
  '113': 'rarecrow-2',
  '126': 'rarecrow-3',
  '136': 'rarecrow-4',
  '137': 'rarecrow-5',
  '138': 'rarecrow-6',
  '139': 'rarecrow-7',
  '140': 'rarecrow-8',
  '130': 'chest',
  '232': 'stone-chest',
  BigChest: 'big-chest',
  BigStoneChest: 'big-stone-chest',
};

/** What weeds, stones, twigs and the like are counted as when left out. */
const DEBRIS = 'Weeds, stones and twigs';
const DEBRIS_NAMES = new Set(['Weeds', 'Stone', 'Twig', 'Artifact Spot', 'Seed Spot']);
/** Things in a save that aren't part of a layout, left out without a word: hay in feeding troughs. */
const IGNORED_NAMES = new Set(['Hay']);

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_NAME = new Map(
  CATALOG.filter((item) => item.category !== 'crops').map((item) => [normalize(item.name), item]),
);

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
/**
 * Reads a location's ground and what stands on it into a plan for a layout: objects (machines,
 * chests, fences and the like), resource clumps, crops and soil, floors, grass, tea bushes and
 * trees. Objects that would overlap one already read are left out and counted.
 */
class LocationReader {
  readonly skipped = new Map<string, number>();
  private readonly tiles = new Map<string, string>();
  private readonly objects: [string, number, number][] = [];
  private readonly occupied = new Set<string>();

  constructor(private readonly layout: LayoutInfo) {}

  skip(what: string): void {
    this.skipped.set(what, (this.skipped.get(what) ?? 0) + 1);
  }

  /** Adds an object unless it would overlap one already added or leave the map. */
  place(item: CatalogItem, x: number, y: number): boolean {
    const cells: string[] = [];
    for (let ty = y; ty < y + item.height; ty++) {
      for (let tx = x; tx < x + item.width; tx++) {
        if (!this.inside(tx, ty) || this.occupied.has(`${tx},${ty}`)) {
          this.skip(`${item.name} (overlapping)`);
          return false;
        }
        cells.push(`${tx},${ty}`);
      }
    }
    for (const cell of cells) this.occupied.add(cell);
    this.objects.push([item.id, x, y]);
    return true;
  }

  paint(itemId: string, x: number, y: number): void {
    if (this.inside(x, y) && !this.tiles.has(`${x},${y}`)) this.tiles.set(`${x},${y}`, itemId);
  }

  get isEmpty(): boolean {
    return !this.tiles.size && !this.objects.length;
  }

  read(location: Element): void {
    const terrain = [...byTile(child(location, 'terrainFeatures'))];
    const treeTiles = new Set(
      terrain.filter(([, , f]) => /Tree$/.test(xsiType(f) ?? '')).map(([x, y]) => `${x},${y}`),
    );
    for (const [x, y, obj] of byTile(child(location, 'objects'))) {
      const name = text(obj, 'name') ?? '';
      const id = text(obj, 'itemId') ?? text(obj, 'parentSheetIndex') ?? '';
      if (IGNORED_NAMES.has(name)) continue;
      if (DEBRIS_NAMES.has(name) || text(obj, 'type') === 'Litter') {
        this.skip(DEBRIS);
        continue;
      }
      // A tapper sits on a tree's trunk, which the tree's own tile covers in the planner.
      if (treeTiles.has(`${x},${y}`)) {
        this.skip(`${name} (on a tree)`);
        continue;
      }
      const held = text(child(obj, 'heldObject')?.firstElementChild, 'name');
      let item =
        text(obj, 'bigCraftable') === 'true' && BIG_CRAFTABLES[id]
          ? findItem(BIG_CRAFTABLES[id])
          : BY_NAME.get(normalize(name));
      if (item && held === 'Pressure Nozzle')
        item = BY_NAME.get(normalize(`${name} + Pressure Nozzle`)) ?? item;
      if (item?.category === 'fences' && held === 'Torch')
        item = BY_NAME.get(normalize(`${name} + Torch`)) ?? item;
      if (!item) this.skip(name);
      else if (item.kind === 'tile') this.paint(item.id, x, y);
      else this.place(item, x, y);
    }

    for (const clump of child(location, 'resourceClumps')?.children ?? []) {
      const tile = child(clump, 'tile');
      const id =
        xsiType(clump) === 'GiantCrop'
          ? GIANT_CROPS[text(clump, 'itemId') ?? text(clump, 'parentSheetIndex') ?? '']
          : CLUMPS[text(clump, 'parentSheetIndex') ?? ''];
      const item = id ? findItem(id) : undefined;
      if (item) this.place(item, Number(text(tile, 'X')), Number(text(tile, 'Y')));
      else this.skip(xsiType(clump) === 'GiantCrop' ? 'Giant crop' : 'Resource clump');
    }

    // Fruit trees take 3x3 tiles in the planner, with the trunk on the bottom row's middle tile;
    // wild trees take their trunk's tile.
    const fruitTrees: [CatalogItem, number, number][] = [];
    const wildTrees: [CatalogItem, number, number][] = [];
    for (const [x, y, feature] of terrain) {
      switch (xsiType(feature)) {
        case 'Flooring': {
          const floor = FLOORS[Number(text(feature, 'whichFloor'))];
          if (floor) this.paint(floor, x, y);
          else this.skip('Floor');
          break;
        }
        case 'Grass':
          this.paint('grass', x, y);
          break;
        case 'HoeDirt': {
          const crop = child(feature, 'crop');
          if (!crop || !crop.children.length || text(crop, 'dead') === 'true') {
            this.paint('farmland', x, y);
            break;
          }
          const cropId =
            WILD_SEEDS[text(crop, 'seedIndex') ?? text(crop, 'netSeedIndex') ?? ''] ??
            CROPS[text(crop, 'indexOfHarvest') ?? ''];
          if (cropId && text(crop, 'forageCrop') !== 'true') this.paint(cropId, x, y);
          else {
            this.skip('Crop');
            this.paint('farmland', x, y);
          }
          break;
        }
        case 'Tree': {
          const item = findItem(WILD_TREES[text(feature, 'treeType') ?? ''] ?? '');
          // Seedlings and saplings sprout all over a farm; only grown trees are part of its layout.
          if (
            item &&
            Number(text(feature, 'growthStage')) >= 5 &&
            text(feature, 'stump') !== 'true'
          )
            wildTrees.push([item, x, y]);
          break;
        }
        case 'FruitTree': {
          const item = findItem(
            FRUIT_TREES[text(feature, 'treeId') ?? text(feature, 'indexOfFruit') ?? ''] ?? '',
          );
          if (item && text(feature, 'stump') !== 'true') fruitTrees.push([item, x, y]);
          else if (!item) this.skip('Fruit tree');
          break;
        }
        case 'Bush':
          // Tea bushes; other bushes are part of the map.
          if (text(feature, 'size') === '3') this.paint('tea', x, y);
          break;
      }
    }
    for (const feature of child(location, 'largeTerrainFeatures')?.children ?? []) {
      const tile = child(feature, 'tilePosition');
      if (xsiType(feature) === 'Bush' && text(feature, 'size') === '3')
        this.paint('tea', Number(text(tile, 'X')), Number(text(tile, 'Y')));
    }
    // Fruit trees (planted on purpose) get their space before wild ones.
    for (const [item, x, y] of fruitTrees) this.place(item, x - 1, y - 2);
    for (const [item, x, y] of wildTrees) this.place(item, x, y);
  }

  plan(extra: Partial<SavedPlan> = {}): SavedPlan {
    const tiles: Record<string, number[]> = {};
    for (const [cell, itemId] of this.tiles) {
      const [x, y] = cell.split(',').map(Number);
      (tiles[itemId] ??= []).push(x, y);
    }
    return { v: 5, layout: this.layout.id, tiles, objects: this.objects, ...extra };
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.layout.width && y < this.layout.height;
  }
}

/**
 * Reads the farm from a Stardew Valley save file (the file named like the save's folder, e.g.
 * Saves/Bopper_439192830/Bopper_439192830): its buildings, machines and other objects, fences,
 * floors, crops, trees and resource clumps, as a plan for the matching farm map; and the insides
 * of its greenhouse, sheds, barns and coops, each as a plan for its interior map. Weeds, stones,
 * twigs and things the planner has no item for are left out and counted.
 */
export function importSave(
  xml: string,
  layouts: readonly LayoutInfo[],
): SaveImport | SaveImportError {
  const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
  if (root.tagName === 'Farmer') return 'save-info';
  if (root.tagName !== 'SaveGame') return 'not-a-save';
  const player = child(root, 'player');
  const locations = [...(child(root, 'locations')?.children ?? [])];
  const farm = locations.find((loc) => text(loc, 'name') === 'Farm');
  if (!farm) return 'not-a-save';

  const whichFarm = Number(text(root, 'whichFarm') ?? 0);
  const layoutId =
    whichFarm === 7
      ? child(root, 'whichModFarm')?.textContent?.includes('Meadowlands')
        ? 'ranching'
        : null
      : FARM_TYPES[whichFarm];
  const layout = layouts.find((l) => l.id === layoutId);
  if (!layout) return 'unknown-farm';
  const reader = new LocationReader(layout);

  // Buildings first: they're what the rest of the farm is laid out around.
  const houseLevel = Number(text(player, 'houseUpgradeLevel') ?? 0);
  const house = variantsOf('house')[Math.min(houseLevel, 2)];
  const mail = new Set(
    [...(child(player, 'mailReceived')?.children ?? [])].map((m) => m.textContent),
  );
  const greenhouseFixed =
    text(farm, 'greenhouseUnlocked') === 'true' || mail.has('ccPantry') || mail.has('jojaPantry');
  const greenhouse = findItem(greenhouseFixed ? 'greenhouse-fixed' : 'greenhouse')!;
  const families = new Set<string>();
  const buildings = [...(child(farm, 'buildings')?.children ?? [])];
  for (const building of buildings) {
    const type = text(building, 'buildingType') ?? '';
    const skin = text(building, 'skinId');
    const item =
      type === 'Farmhouse'
        ? house
        : type === 'Greenhouse'
          ? greenhouse
          : BY_NAME.get(normalize(skin || (type === 'Cabin' ? 'Stone Cabin' : type)));
    if (!item) {
      reader.skip(type);
      continue;
    }
    if (reader.place(item, Number(text(building, 'tileX')), Number(text(building, 'tileY'))))
      families.add(variantsOf(item.id)[0]?.id ?? item.id);
  }
  // Older saves leave out buildings that were part of the map then.
  for (const spot of defaultBuildings(layout)) {
    const family = variantsOf(spot.itemId)[0]?.id ?? spot.itemId;
    if (
      !['house', 'greenhouse', 'shipping-bin', 'pet-bowl'].includes(family) ||
      families.has(family)
    )
      continue;
    const item =
      family === 'house' ? house : family === 'greenhouse' ? greenhouse : findItem(spot.itemId)!;
    reader.place(item, spot.x, spot.y);
  }
  reader.read(farm);

  const farmName = text(player, 'farmName');
  const name = farmName ? `${farmName} Farm` : 'Imported farm';

  // The greenhouse and each shed, barn and coop, where anything's in them.
  const interiors: ImportedPlan[] = [];
  const readInterior = (location: Element | null | undefined, layoutId: string, label: string) => {
    const interiorLayout = layouts.find((l) => l.id === layoutId);
    if (!location || !interiorLayout) return;
    const inside = new LocationReader(interiorLayout);
    inside.read(location);
    if (!inside.isEmpty)
      interiors.push({ plan: inside.plan(), name: `${name}: ${label}`, skipped: inside.skipped });
  };
  readInterior(
    locations.find((loc) => text(loc, 'name') === 'Greenhouse'),
    'greenhouse',
    'Greenhouse',
  );
  const counts = new Map<string, number>();
  for (const building of buildings)
    counts.set(
      text(building, 'buildingType') ?? '',
      (counts.get(text(building, 'buildingType') ?? '') ?? 0) + 1,
    );
  for (const building of buildings) {
    const type = text(building, 'buildingType') ?? '';
    if (!INTERIORS[type]) continue;
    // "Big Shed", or "Big Shed at 11, 8" when there's more than one.
    const label =
      counts.get(type)! > 1
        ? `${type} at ${text(building, 'tileX')}, ${text(building, 'tileY')}`
        : type;
    readInterior(child(building, 'indoors'), INTERIORS[type], label);
  }

  return {
    plan: reader.plan(text(farm, 'greenhouseMoved') === 'true' ? { greenhouseMoved: true } : {}),
    name,
    skipped: reader.skipped,
    interiors,
  };
}
