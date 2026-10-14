/**
 * Placeable item catalog. Ids, names and footprints are derived from the
 * Apache-2.0 licensed v2 planner (https://github.com/hpeinar/stardewplanner);
 * building art and footprints, and the art for items the v2 planner lacks (1.6 crops, machines
 * and trees), come from the game's own data (see game-art.generated.ts).
 */
import { BuildingRules, GameArt, MapSeason, Tiling } from './game-art';
import { BUILDING_RULES, GAME_ART, TILINGS } from './game-art.generated';

/** Which restriction layer an item must respect when placed. */
export type Restriction = 'tillable' | 'buildable' | 'accessible';

/** Tiles live on the ground grid (one per cell); objects have a footprint and sit above tiles. */
export type ItemKind = 'tile' | 'object';

export type Category = 'buildings' | 'crops' | 'craftables' | 'trees' | 'paths' | 'fences' | 'decor' | 'misc';

export type Season = 'spring' | 'summer' | 'fall' | 'winter' | 'island';

export interface RangeShape {
  /** diamond: manhattan distance; square: chebyshev distance; circle: euclidean distance. */
  shape: 'diamond' | 'square' | 'circle';
  radius: number;
  /** Tile offset from the item's top-left corner to the centre of the range. */
  origin?: { x: number; y: number };
  /** Whether the centre tile itself is covered. */
  includeCenter?: boolean;
  color: number;
  /** Range group, used for the per-group "always show" toggles. */
  group: RangeGroup;
}

export type RangeGroup = 'sprinkler' | 'scarecrow' | 'beehive' | 'junimo';

export interface CatalogItem {
  id: string;
  name: string;
  kind: ItemKind;
  category: Category;
  /** Sprite file name under assets/sprites, without extension. */
  sprite: string;
  /** Footprint in tiles. */
  width: number;
  height: number;
  /** Sprite height in tiles when the art (a roof) extends above the footprint (v2 sprites). */
  spriteHeight?: number;
  /** Art cropped from the game, drawn exactly as the game positions it. Preferred over `sprite`. */
  art?: GameArt;
  /** For buildings: how they sit on the farm, from the game's data. */
  building?: BuildingRules;
  /** For fences and floors: how they join their neighbours on the map (the sprite stays the icon). */
  tiling?: Tiling;
  restriction: Restriction;
  seasons?: readonly Season[];
  range?: RangeShape;
}

const SPRINKLER = 0x3b82f6;
const SCARECROW = 0x22c55e;
const BEEHIVE = 0xfacc15;
const JUNIMO = 0x89cff0;

type Extra = Partial<Omit<CatalogItem, 'id' | 'name' | 'kind' | 'category'>>;

function tile(id: string, name: string, category: Category, extra: Extra = {}): CatalogItem {
  return { id, name, kind: 'tile', category, sprite: id, width: 1, height: 1, restriction: 'tillable', ...extra };
}

function object(id: string, name: string, category: Category, extra: Extra = {}): CatalogItem {
  return { id, name, kind: 'object', category, sprite: id, width: 1, height: 1, restriction: 'accessible', ...extra };
}

function crop(id: string, name: string, seasons: readonly Season[]): CatalogItem {
  return tile(id, name, 'crops', { seasons });
}

function building(id: string, name: string, width: number, height: number, extra: Extra = {}): CatalogItem {
  return object(id, name, 'buildings', { width, height, restriction: 'buildable', ...extra });
}

/** Fruit trees: 3x3, the space they need clear around them to grow. */
function tree(id: string, name: string, sprite = id): CatalogItem {
  return object(id, name, 'trees', { sprite, width: 3, height: 3 });
}

/** Wild trees stand on one tile, as in the game, with their canopy drawn over the tiles around it. */
function wildTree(id: string, name: string): CatalogItem {
  return object(id, name, 'trees');
}

const ITEMS: readonly CatalogItem[] = [
  // Buildings
  // The farmhouse and greenhouse roofs hang over the tiles behind them.
  building('house', 'Farmhouse', 9, 5, { spriteHeight: 9 }),
  building('house-upgrade-2', 'Farmhouse (upgrade 2)', 9, 5, { spriteHeight: 9 }),
  building('house-upgrade-3', 'Farmhouse (upgrade 3)', 9, 5, { spriteHeight: 9 }),
  building('greenhouse', 'Greenhouse (broken)', 7, 6, { sprite: 'greenhouse-broken', spriteHeight: 10 }),
  building('greenhouse-fixed', 'Greenhouse', 7, 6, { spriteHeight: 10 }),
  building('barn', 'Barn', 7, 4),
  building('big-barn', 'Big Barn', 7, 4),
  building('deluxe-barn', 'Deluxe Barn', 7, 4, { sprite: 'big-barn' }),
  building('coop', 'Coop', 6, 3),
  building('big-coop', 'Big Coop', 6, 3, { sprite: 'coop' }),
  building('deluxe-coop', 'Deluxe Coop', 6, 3, { sprite: 'coop' }),
  building('silo', 'Silo', 3, 3),
  building('well', 'Well', 3, 3),
  building('stable', 'Stable', 4, 2),
  building('fish-pond', 'Fish Pond', 5, 5),
  building('slime-hutch', 'Slime Hutch', 7, 4),
  building('mill', 'Mill', 4, 2),
  building('shed', 'Shed', 7, 3),
  building('big-shed', 'Big Shed', 7, 3, { sprite: 'shed' }),
  building('stone-cabin', 'Stone Cabin', 5, 3),
  building('plank-cabin', 'Plank Cabin', 5, 3),
  building('log-cabin', 'Log Cabin', 5, 3),
  building('rustic-cabin', 'Rustic Cabin', 5, 3),
  building('trailer-cabin', 'Trailer Cabin', 5, 3),
  building('neighbor-cabin', 'Neighbor Cabin', 5, 3),
  building('beach-cabin', 'Beach Cabin', 5, 3),
  building('pet-bowl', 'Pet Bowl', 2, 2),
  building('stone-pet-bowl', 'Stone Pet Bowl', 2, 2),
  building('hay-pet-bowl', 'Hay Pet Bowl', 2, 2),
  building('shipping-bin', 'Shipping Bin', 2, 1, { spriteHeight: 2 }),
  building('junimo-hut', 'Junimo Hut', 3, 2, {
    range: { shape: 'square', radius: 8, origin: { x: 1, y: 1 }, includeCenter: true, color: JUNIMO, group: 'junimo' },
  }),
  building('earth-obelisk', 'Earth Obelisk', 3, 2),
  building('water-obelisk', 'Water Obelisk', 3, 2),
  building('desert-obelisk', 'Desert Obelisk', 3, 2),
  building('island-obelisk', 'Island Obelisk', 3, 2),
  building('gold-clock', 'Gold Clock', 3, 2),

  // Craftables
  object('sprinkler', 'Sprinkler', 'craftables', {
    range: { shape: 'diamond', radius: 1, color: SPRINKLER, group: 'sprinkler' },
  }),
  object('q-sprinkler', 'Quality Sprinkler', 'craftables', {
    range: { shape: 'square', radius: 1, color: SPRINKLER, group: 'sprinkler' },
  }),
  object('irid-sprinkler', 'Iridium Sprinkler', 'craftables', {
    range: { shape: 'square', radius: 2, color: SPRINKLER, group: 'sprinkler' },
  }),
  object('pressured-sprinkler', 'Sprinkler + Pressure Nozzle', 'craftables', {
    sprite: 'sprinkler-pressured',
    range: { shape: 'square', radius: 1, color: SPRINKLER, group: 'sprinkler' },
  }),
  object('q-pressured-sprinkler', 'Quality Sprinkler + Pressure Nozzle', 'craftables', {
    sprite: 'q-sprinkler-pressured',
    range: { shape: 'square', radius: 2, color: SPRINKLER, group: 'sprinkler' },
  }),
  object('irid-pressured-sprinkler', 'Iridium Sprinkler + Pressure Nozzle', 'craftables', {
    sprite: 'irid-sprinkler-pressured',
    range: { shape: 'square', radius: 3, color: SPRINKLER, group: 'sprinkler' },
  }),
  object('scarecrow', 'Scarecrow', 'craftables', {
    range: { shape: 'circle', radius: 8, color: SCARECROW, group: 'scarecrow' },
  }),
  object('deluxe-scarecrow', 'Deluxe Scarecrow', 'craftables', {
    range: { shape: 'circle', radius: 16, color: SCARECROW, group: 'scarecrow' },
  }),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    object(`rarecrow-${n}`, `Rarecrow ${n}`, 'craftables', {
      range: { shape: 'circle', radius: 8, color: SCARECROW, group: 'scarecrow' },
    }),
  ),
  object('bee-hive', 'Bee House', 'craftables', {
    range: { shape: 'diamond', radius: 5, color: BEEHIVE, group: 'beehive' },
  }),
  object('furnace', 'Furnace', 'craftables'),
  object('heavy-furnace', 'Heavy Furnace', 'craftables'),
  object('charcoal-kiln', 'Charcoal Kiln', 'craftables', { sprite: 'charcoal' }),
  object('seed-maker', 'Seed Maker', 'craftables'),
  object('crystalarium', 'Crystalarium', 'craftables', { sprite: 'crystal' }),
  object('recycling-machine', 'Recycling Machine', 'craftables'),
  object('slime-egg-press', 'Slime Egg-Press', 'craftables', { sprite: 'egg-press' }),
  object('slime-incubator', 'Slime Incubator', 'craftables'),
  object('worm-bin', 'Worm Bin', 'craftables'),
  object('deluxe-worm-bin', 'Deluxe Worm Bin', 'craftables'),
  object('wood-chipper', 'Wood Chipper', 'craftables'),
  object('workbench', 'Workbench', 'craftables'),
  object('auto-petter', 'Auto-Petter', 'craftables'),
  object('bone-mill', 'Bone Mill', 'craftables'),
  object('farm-computer', 'Farm Computer', 'craftables'),
  object('geode-crusher', 'Geode Crusher', 'craftables'),
  object('heavy-tapper', 'Heavy Tapper', 'craftables'),
  object('hopper', 'Hopper', 'craftables'),
  object('solar-panel', 'Solar Panel', 'craftables'),
  object('mayonnaise-machine', 'Mayonnaise Machine', 'craftables', { sprite: 'mayo' }),
  object('cheese-press', 'Cheese Press', 'craftables'),
  object('keg', 'Keg', 'craftables'),
  object('loom', 'Loom', 'craftables'),
  object('oil-maker', 'Oil Maker', 'craftables'),
  object('preserves-jar', 'Preserves Jar', 'craftables', { sprite: 'preserves' }),
  object('chest', 'Chest', 'craftables'),
  object('stone-chest', 'Stone Chest', 'craftables'),
  object('big-chest', 'Big Chest', 'craftables'),
  object('big-stone-chest', 'Big Stone Chest', 'craftables'),
  object('mini-shipping-bin', 'Mini-Shipping Bin', 'craftables'),
  object('lightning-rod', 'Lightning Rod', 'craftables', { sprite: 'lighting-rod' }),
  object('mini-obelisk', 'Mini-Obelisk', 'craftables'),
  object('mini-jukebox', 'Mini-Jukebox', 'craftables'),
  object('statue-of-endless-fortune', 'Statue of Endless Fortune', 'craftables'),
  object('tapper', 'Tapper', 'craftables'),
  object('anvil', 'Anvil', 'craftables'),
  object('bait-maker', 'Bait Maker', 'craftables'),
  object('cask', 'Cask', 'craftables'),
  object('dehydrator', 'Dehydrator', 'craftables'),
  object('fish-smoker', 'Fish Smoker', 'craftables'),
  object('garden-pot', 'Garden Pot', 'craftables'),
  object('mini-forge', 'Mini-Forge', 'craftables'),
  object('mushroom-log', 'Mushroom Log', 'craftables'),
  object('statue-of-blessings', 'Statue of Blessings', 'craftables'),
  object('statue-of-the-dwarf-king', 'Statue of the Dwarf King', 'craftables'),

  // Crops
  tile('farmland', 'Tilled Soil', 'crops'),
  crop('blue-jazz', 'Blue Jazz', ['spring']),
  crop('cauliflower', 'Cauliflower', ['spring']),
  crop('coffee-bean', 'Coffee', ['spring', 'summer']),
  crop('garlic', 'Garlic', ['spring']),
  crop('green-bean', 'Green Bean', ['spring']),
  crop('kale', 'Kale', ['spring']),
  crop('parsnip', 'Parsnip', ['spring']),
  crop('potato', 'Potato', ['spring']),
  crop('rhubarb', 'Rhubarb', ['spring']),
  crop('rice', 'Rice Shoots', ['spring']),
  crop('strawberry', 'Strawberry', ['spring']),
  crop('tulip', 'Tulip', ['spring']),
  crop('carrot', 'Carrot', ['spring']),
  crop('blueberry', 'Blueberry', ['summer']),
  crop('corn', 'Corn', ['summer', 'fall']),
  crop('hops', 'Hops', ['summer']),
  crop('hot-pepper', 'Hot Pepper', ['summer']),
  crop('melon', 'Melon', ['summer']),
  crop('poppy', 'Poppy', ['summer']),
  crop('radish', 'Radish', ['summer']),
  crop('red-cabbage', 'Red Cabbage', ['summer']),
  crop('starfruit', 'Starfruit', ['summer']),
  crop('summer-spangle', 'Summer Spangle', ['summer']),
  crop('tomato', 'Tomato', ['summer']),
  crop('wheat', 'Wheat', ['summer', 'fall']),
  crop('summer-squash', 'Summer Squash', ['summer']),
  crop('pineapple', 'Pineapple', ['summer']),
  crop('taro-root', 'Taro Root', ['summer']),
  crop('amaranth', 'Amaranth', ['fall']),
  crop('artichoke', 'Artichoke', ['fall']),
  crop('beet', 'Beet', ['fall']),
  crop('bok-choy', 'Bok Choy', ['fall']),
  crop('cranberry', 'Cranberry', ['fall']),
  crop('eggplant', 'Eggplant', ['fall']),
  crop('fairy-rose', 'Fairy Rose', ['fall']),
  crop('grape', 'Grape', ['fall']),
  crop('pumpkin', 'Pumpkin', ['fall']),
  crop('sunflower', 'Sunflower', ['summer', 'fall']),
  crop('yam', 'Yam', ['fall']),
  crop('sweet-gem-berry', 'Sweet Gem Berry', ['fall']),
  crop('broccoli', 'Broccoli', ['fall']),
  crop('powdermelon', 'Powdermelon', ['winter']),
  crop('qi-fruit', 'Qi Fruit', ['spring', 'summer', 'fall', 'winter']),
  crop('fiber', 'Fiber', ['spring', 'summer', 'fall', 'winter']),
  crop('spring-seeds', 'Spring Seeds (wild)', ['spring']),
  crop('summer-seeds', 'Summer Seeds (wild)', ['summer']),
  crop('fall-seeds', 'Fall Seeds (wild)', ['fall']),
  crop('winter-seeds', 'Winter Seeds (wild)', ['winter']),
  crop('ancient-fruit', 'Ancient Fruit', ['spring', 'summer', 'fall']),
  crop('tea', 'Tea Bush', ['spring', 'summer', 'fall']),
  tile('trellis', 'Trellis', 'crops'),
  object('giant-cauliflower', 'Giant Cauliflower', 'crops', { width: 3, height: 3, restriction: 'tillable' }),
  object('giant-melon', 'Giant Melon', 'crops', { width: 3, height: 3, restriction: 'tillable' }),
  object('giant-pumpkin', 'Giant Pumpkin', 'crops', { width: 3, height: 3, restriction: 'tillable' }),
  object('giant-powdermelon', 'Giant Powdermelon', 'crops', { width: 3, height: 3, restriction: 'tillable' }),
  object('giant-qi-fruit', 'Giant Qi Fruit', 'crops', { width: 3, height: 3, restriction: 'tillable' }),

  // Trees
  tree('apple', 'Apple Tree'),
  tree('apricot', 'Apricot Tree'),
  tree('cherry-tree', 'Cherry Tree'),
  tree('orange-tree', 'Orange Tree'),
  tree('peach', 'Peach Tree'),
  tree('pomegranate', 'Pomegranate Tree'),
  tree('banana-tree', 'Banana Tree'),
  tree('mango-tree', 'Mango Tree'),
  wildTree('oak-tree', 'Oak Tree'),
  wildTree('maple-tree', 'Maple Tree'),
  wildTree('pine-tree', 'Pine Tree'),
  wildTree('mahogany-tree', 'Mahogany Tree'),
  wildTree('mushroom-tree', 'Mushroom Tree'),
  wildTree('palm-tree', 'Palm Tree'),
  wildTree('island-palm-tree', 'Palm Tree (island)'),
  wildTree('mystic-tree', 'Mystic Tree'),
  // Green Rain variants of the oak, maple and pine, grown from Mossy Seeds.
  wildTree('mossy-oak-tree', 'Mossy Tree (broadleaf)'),
  wildTree('mossy-maple-tree', 'Mossy Tree (vines)'),
  wildTree('mossy-pine-tree', 'Mossy Tree (fiddlehead)'),
  tile('tree', 'Tree (marker)', 'trees', { restriction: 'accessible' }),

  // Paths & floors
  tile('road', 'Cobblestone Path', 'paths', { restriction: 'accessible' }),
  tile('gravel-path', 'Gravel Path', 'paths', { restriction: 'accessible' }),
  tile('wood-path', 'Wood Path', 'paths', { restriction: 'accessible' }),
  tile('steppingstone-path', 'Stepping Stone Path', 'paths', { restriction: 'accessible' }),
  tile('crystal-path', 'Crystal Path', 'paths', { restriction: 'accessible' }),
  tile('wood-floor', 'Wood Floor', 'paths', { restriction: 'accessible' }),
  tile('brick-floor', 'Brick Floor', 'paths', { restriction: 'accessible' }),
  tile('straw-floor', 'Straw Floor', 'paths', { restriction: 'accessible' }),
  tile('weathered-floor', 'Weathered Floor', 'paths', { restriction: 'accessible' }),
  tile('stone-floor', 'Stone Floor', 'paths', { restriction: 'accessible' }),
  tile('crystal-floor', 'Crystal Floor', 'paths', { restriction: 'accessible' }),
  tile('rustic-plank-floor', 'Rustic Plank Floor', 'paths', { restriction: 'accessible' }),
  tile('stone-walkway', 'Stone Walkway Floor', 'paths', { restriction: 'accessible' }),

  // Fences
  tile('fence', 'Wood Fence', 'fences', { restriction: 'accessible' }),
  tile('stone-fence', 'Stone Fence', 'fences', { restriction: 'accessible' }),
  tile('iron-fence', 'Iron Fence', 'fences', { restriction: 'accessible' }),
  tile('hardwood-fence', 'Hardwood Fence', 'fences', { restriction: 'accessible' }),
  tile('torch-fence', 'Wood Fence + Torch', 'fences', { restriction: 'accessible' }),
  tile('torch-stone-fence', 'Stone Fence + Torch', 'fences', { restriction: 'accessible' }),
  tile('torch-iron-fence', 'Iron Fence + Torch', 'fences', { restriction: 'accessible' }),
  tile('torch-hardwood-fence', 'Hardwood Fence + Torch', 'fences', { restriction: 'accessible' }),
  object('gate', 'Gate', 'fences'),

  // Decor & lighting
  object('torch', 'Torch', 'decor'),
  object('campfire', 'Campfire', 'decor'),
  object('wooden-brazier', 'Wooden Brazier', 'decor'),
  object('stone-brazier', 'Stone Brazier', 'decor'),
  object('gold-brazier', 'Gold Brazier', 'decor'),
  object('carved-brazier', 'Carved Brazier', 'decor'),
  object('stump-brazier', 'Stump Brazier', 'decor'),
  object('barrel-brazier', 'Barrel Brazier', 'decor'),
  object('skull-brazier', 'Skull Brazier', 'decor'),
  object('marble-brazier', 'Marble Brazier', 'decor'),
  object('wood-lamp-post', 'Wood Lamp-post', 'decor'),
  object('iron-lamp-post', 'Iron Lamp-post', 'decor'),
  object('wood-sign', 'Wood Sign', 'decor'),
  object('stone-sign', 'Stone Sign', 'decor'),
  object('dark-sign', 'Dark Sign', 'decor'),
  object('text-sign', 'Text Sign', 'decor'),
  object('jack-o-lantern', 'Jack-O-Lantern', 'decor'),
  object('tub-o-flowers', "Tub o' Flowers", 'decor'),
  object('wicked-statue', 'Wicked Statue', 'decor'),
  object('drum-block', 'Drum Block', 'decor'),
  object('flute-block', 'Flute Block', 'decor'),
  tile('tulips', 'Flowers', 'decor'),

  // Misc
  tile('grass', 'Grass', 'misc'),
  tile('weeds', 'Weeds', 'misc', { restriction: 'accessible' }),
  tile('stone', 'Stone', 'misc', { restriction: 'accessible' }),
  tile('twig', 'Twig', 'misc', { restriction: 'accessible' }),
  object('large-rock', 'Large Rock', 'misc', { width: 2, height: 2 }),
  object('large-log', 'Large Log', 'misc', { width: 2, height: 2 }),
  object('large-stump', 'Large Stump', 'misc', { width: 2, height: 2 }),
  object('meteorite', 'Meteorite', 'misc', { width: 2, height: 2 }),
  tile('object-restriction', 'Object Restriction', 'misc', { restriction: 'accessible' }),
  tile('building-restriction', 'Building Restriction', 'misc', { restriction: 'accessible' }),
];

/** Every placeable item, with game art and building rules attached where they have been imported. */
export const CATALOG: readonly CatalogItem[] = ITEMS.map((item) => {
  const art = GAME_ART[item.id];
  const building = BUILDING_RULES[item.id];
  const tiling = TILINGS[item.id];
  return { ...item, ...(art && { art }), ...(building && { building }), ...(tiling && { tiling }) };
});

export const CATEGORIES: readonly { id: Category; name: string }[] = [
  { id: 'buildings', name: 'Buildings' },
  { id: 'crops', name: 'Crops' },
  { id: 'craftables', name: 'Craftables' },
  { id: 'trees', name: 'Trees' },
  { id: 'paths', name: 'Paths & Floors' },
  { id: 'fences', name: 'Fences' },
  { id: 'decor', name: 'Decor' },
  { id: 'misc', name: 'Misc' },
];

/** Legacy v2 ids that map onto a canonical catalog id. */
export const ALIASES: Readonly<Record<string, string>> = {
  'wood-fence': 'fence',
  'torch-wood-fence': 'torch-fence',
  hoedirt: 'farmland',
  mayo: 'mayonnaise-machine',
  preserves: 'preserves-jar',
  charcoal: 'charcoal-kiln',
  crystal: 'crystalarium',
  'egg-press': 'slime-egg-press',
  'lighting-rod': 'lightning-rod',
  'wooden-braizer': 'wooden-brazier',
};

/**
 * Groups of interchangeable items: upgrades, tiers and styles of the same thing.
 * Clicking a placed item lets you switch between the members of its group.
 */
export const VARIANT_FAMILIES: readonly (readonly string[])[] = [
  ['house', 'house-upgrade-2', 'house-upgrade-3'],
  ['greenhouse', 'greenhouse-fixed'],
  ['barn', 'big-barn', 'deluxe-barn'],
  ['coop', 'big-coop', 'deluxe-coop'],
  ['shed', 'big-shed'],
  ['stone-cabin', 'plank-cabin', 'log-cabin', 'rustic-cabin', 'trailer-cabin', 'neighbor-cabin', 'beach-cabin'],
  ['pet-bowl', 'stone-pet-bowl', 'hay-pet-bowl'],
  ['scarecrow', 'deluxe-scarecrow', 'rarecrow-1', 'rarecrow-2', 'rarecrow-3', 'rarecrow-4', 'rarecrow-5', 'rarecrow-6', 'rarecrow-7', 'rarecrow-8'],
  ['sprinkler', 'q-sprinkler', 'irid-sprinkler'],
  ['pressured-sprinkler', 'q-pressured-sprinkler', 'irid-pressured-sprinkler'],
  ['chest', 'stone-chest', 'big-chest', 'big-stone-chest'],
  ['wood-sign', 'stone-sign', 'dark-sign', 'text-sign'],
  ['furnace', 'heavy-furnace'],
  ['worm-bin', 'deluxe-worm-bin'],
  ['wood-lamp-post', 'iron-lamp-post'],
  ['torch', 'campfire', 'wooden-brazier', 'stone-brazier', 'gold-brazier', 'carved-brazier', 'stump-brazier', 'barrel-brazier', 'skull-brazier', 'marble-brazier'],
];

const BY_ID = new Map(CATALOG.map((item) => [item.id, item]));
const FAMILY_OF = new Map(VARIANT_FAMILIES.flatMap((family) => family.map((id) => [id, family] as const)));

/** Every variant of an item, including itself, in display order. Empty when it has none. */
export function variantsOf(id: string): CatalogItem[] {
  const family = FAMILY_OF.get(ALIASES[id] ?? id);
  return family ? family.map((member) => BY_ID.get(member)!) : [];
}

export function findItem(id: string): CatalogItem | undefined {
  return BY_ID.get(ALIASES[id] ?? id);
}

/** Whole tiles the art extends above the footprint (roofs), for hit-testing. */
export function spriteOverhang(item: CatalogItem): number {
  if (item.art) return Math.max(0, Math.ceil((item.art.height - item.art.offsetY) / 16) - item.height);
  return (item.spriteHeight ?? item.height) - item.height;
}

/** An item's sprite, in a season's look where its art changes with the seasons (trees). */
export function spriteUrl(item: CatalogItem, season: MapSeason = 'spring'): string {
  if (!item.art) return `assets/sprites/${item.sprite}.png`;
  return `assets/game/${(season !== 'spring' && item.art.seasons?.[season]) || item.art.file}`;
}
