/**
 * Imports building art and footprints from Stardew Valley's own content, unpacked with
 * StardewXnbHack (https://github.com/Pathoschild/StardewXnbHack) from your copy of the game.
 *
 * Usage: node scripts/import-game.mts "<path to Content (unpacked)>"
 *
 * Writes cropped building, machine, crop and tree sprites to public/assets/game/, and their draw
 * metadata and the buildings' placement rules to src/app/core/data/game-art.generated.ts.
 * Stardew Valley's art is © ConcernedApe.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  BuildingRules,
  GroundEffect,
  MapSeason,
  SeasonalFiles,
  Tiling,
} from '../src/app/core/data/game-art.ts';
import { type Image, blank, crop, decodePng, encodePng, paste } from './png.mts';

const TILE = 16;
const ROOT = resolve(import.meta.dirname, '..');

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/import-game.mts "<path to Content (unpacked)>"');
  process.exit(1);
}
const content = resolve(source);

interface DataRect {
  X: number;
  Y: number;
  Width: number;
  Height: number;
}

interface BuildingData {
  Texture: string;
  Size: { X: number; Y: number };
  SourceRect?: DataRect;
  DrawOffset?: string;
  HumanDoor?: { X: number; Y: number };
  AdditionalPlacementTiles?: { TileArea: DataRect; OnlyNeedsToBePassable: boolean }[] | null;
  AllowsFlooringUnderneath?: boolean;
  /** Rows of X (solid) and O (passable), which may reach past the footprint. */
  CollisionMap?: string | null;
  DrawLayers?:
    | {
        Texture: string | null;
        SourceRect: DataRect;
        DrawPosition: string;
        DrawInBackground: boolean;
      }[]
    | null;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A catalog item drawn from a game building. */
interface BuildingArt {
  /** Key in Data/Buildings.json (footprint and draw settings). */
  building: string;
  /** Texture under Buildings/, when not the building's own (variants and skins). */
  texture?: string;
  /** Source rectangle, when not the building's own. */
  rect?: Rect;
}

const BUILDINGS: Record<string, BuildingArt> = {
  house: { building: 'Farmhouse' },
  // Farmhouse upgrades are stacked below the base house in the same sheet.
  'house-upgrade-2': { building: 'Farmhouse', rect: { x: 0, y: 144, width: 160, height: 144 } },
  'house-upgrade-3': { building: 'Farmhouse', rect: { x: 0, y: 288, width: 160, height: 144 } },
  // The greenhouse sheet holds the broken greenhouse above the repaired one.
  greenhouse: { building: 'Greenhouse', rect: { x: 0, y: 0, width: 112, height: 160 } },
  'greenhouse-fixed': { building: 'Greenhouse' },
  coop: { building: 'Coop' },
  'big-coop': { building: 'Big Coop' },
  'deluxe-coop': { building: 'Deluxe Coop' },
  barn: { building: 'Barn' },
  'big-barn': { building: 'Big Barn' },
  'deluxe-barn': { building: 'Deluxe Barn' },
  shed: { building: 'Shed' },
  'big-shed': { building: 'Big Shed' },
  silo: { building: 'Silo' },
  well: { building: 'Well' },
  mill: { building: 'Mill' },
  stable: { building: 'Stable' },
  'slime-hutch': { building: 'Slime Hutch' },
  // The fish pond sheet is a set of parts; the 5x5 stone rim is the base.
  'fish-pond': { building: 'Fish Pond', rect: { x: 0, y: 0, width: 80, height: 80 } },
  'junimo-hut': { building: 'Junimo Hut' },
  'earth-obelisk': { building: 'Earth Obelisk' },
  'water-obelisk': { building: 'Water Obelisk' },
  'desert-obelisk': { building: 'Desert Obelisk' },
  'island-obelisk': { building: 'Island Obelisk' },
  'gold-clock': { building: 'Gold Clock' },
  'shipping-bin': { building: 'Shipping Bin' },
  'stone-cabin': { building: 'Cabin', texture: 'Stone Cabin' },
  'plank-cabin': { building: 'Cabin', texture: 'Plank Cabin' },
  'log-cabin': { building: 'Cabin', texture: 'Log Cabin' },
  'rustic-cabin': { building: 'Cabin', texture: 'Rustic Cabin' },
  'trailer-cabin': { building: 'Cabin', texture: 'Trailer Cabin' },
  'neighbor-cabin': { building: 'Cabin', texture: 'Neighbor Cabin' },
  'beach-cabin': { building: 'Cabin', texture: 'Beach Cabin' },
  'pet-bowl': { building: 'Pet Bowl' },
  'stone-pet-bowl': { building: 'Pet Bowl', texture: 'Stone Pet Bowl' },
  'hay-pet-bowl': { building: 'Pet Bowl', texture: 'Hay Pet Bowl' },
};

/** Items drawn with a big craftable's or an object's sprite, by their id in Data/BigCraftables.json or Data/Objects.json. */
const ITEMS: Record<string, { bigCraftable: string } | { object: string }> = {
  // Machines and storage
  anvil: { bigCraftable: 'Anvil' },
  'bait-maker': { bigCraftable: 'BaitMaker' },
  'big-chest': { bigCraftable: 'BigChest' },
  'big-stone-chest': { bigCraftable: 'BigStoneChest' },
  cask: { bigCraftable: '163' },
  dehydrator: { bigCraftable: 'Dehydrator' },
  'deluxe-worm-bin': { bigCraftable: 'DeluxeWormBin' },
  'fish-smoker': { bigCraftable: 'FishSmoker' },
  'garden-pot': { bigCraftable: '62' },
  'heavy-furnace': { bigCraftable: 'HeavyFurnace' },
  'mini-forge': { bigCraftable: 'MiniForge' },
  'mushroom-log': { bigCraftable: 'MushroomLog' },
  'statue-of-blessings': { bigCraftable: 'StatueOfBlessings' },
  'statue-of-the-dwarf-king': { bigCraftable: 'StatueOfTheDwarfKing' },
  'text-sign': { bigCraftable: 'TextSign' },
  'tub-o-flowers': { bigCraftable: '108' },
  'wicked-statue': { bigCraftable: '83' },
  'rarecrow-1': { bigCraftable: '110' },
  'rarecrow-2': { bigCraftable: '113' },
  'rarecrow-3': { bigCraftable: '126' },
  'rarecrow-4': { bigCraftable: '136' },
  'rarecrow-5': { bigCraftable: '137' },
  'rarecrow-6': { bigCraftable: '138' },
  'rarecrow-7': { bigCraftable: '139' },
  'rarecrow-8': { bigCraftable: '140' },
  // Decor
  'jack-o-lantern': { object: '746' },
  'drum-block': { object: '463' },
  'flute-block': { object: '464' },
  // Crops, shown as their harvest (or, for wild seeds, the seed packet)
  carrot: { object: 'Carrot' },
  'summer-squash': { object: 'SummerSquash' },
  broccoli: { object: 'Broccoli' },
  powdermelon: { object: 'Powdermelon' },
  'qi-fruit': { object: '889' },
  pineapple: { object: '832' },
  'taro-root': { object: '830' },
  fiber: { object: '771' },
  'spring-seeds': { object: '495' },
  'summer-seeds': { object: '496' },
  'fall-seeds': { object: '497' },
  'winter-seeds': { object: '498' },
};

/** Items cropped from a texture by hand: giant crops (Data/GiantCrops.json). */
const CROPPED: Record<
  string,
  { texture: string; rect: Rect; footprint: { width: number; height: number } }
> = {
  // Giant crops draw one row above their 3x3 footprint.
  'giant-powdermelon': {
    texture: 'LooseSprites/Cursors_1_6',
    rect: { x: 320, y: 448, width: 48, height: 64 },
    footprint: { width: 3, height: 3 },
  },
  'giant-qi-fruit': {
    texture: 'LooseSprites/Cursors_1_6',
    rect: { x: 368, y: 448, width: 48, height: 64 },
    footprint: { width: 3, height: 3 },
  },
};

const SEASONS: readonly MapSeason[] = ['spring', 'summer', 'fall', 'winter'];

/**
 * Grown wild trees, by their id in Data/WildTrees.json. They stand on one tile: Tree.draw puts the
 * stump (32, 96, 16x32) on it and centres the 48x96 canopy above, bottoms aligned.
 */
const WILD_TREES: Record<string, string> = {
  'oak-tree': '1',
  'maple-tree': '2',
  'pine-tree': '3',
  'mahogany-tree': '8',
  'mushroom-tree': '7',
  'palm-tree': '6',
  'island-palm-tree': '9',
  'mossy-oak-tree': '10',
  'mossy-maple-tree': '11',
  'mossy-pine-tree': '12',
  'mystic-tree': '13',
};

/**
 * Grown fruit trees, by their sapling's id in Data/FruitTrees.json. Each row of their sheet holds
 * growth stages then a 48x80 grown tree per season from x = 192; the trunk stands in the middle of
 * the bottom row of the planner's 3x3 footprint.
 */
const FRUIT_TREES: Record<string, string> = {
  'cherry-tree': '628',
  apricot: '629',
  'orange-tree': '630',
  peach: '631',
  pomegranate: '632',
  apple: '633',
  'banana-tree': '69',
  'mango-tree': '835',
};

/** Fences by their item id in Data/Fences.json; the torch variants are the same fence holding a torch. */
const FENCES: Record<string, { fence: string; torch?: boolean }> = {
  fence: { fence: '322' },
  'stone-fence': { fence: '323' },
  'iron-fence': { fence: '324' },
  'hardwood-fence': { fence: '298' },
  'torch-fence': { fence: '322', torch: true },
  'torch-stone-fence': { fence: '323', torch: true },
  'torch-iron-fence': { fence: '324', torch: true },
  'torch-hardwood-fence': { fence: '298', torch: true },
};

/** Floors and paths by their id in Data/FloorsAndPaths.json. */
const FLOORS: Record<string, string> = {
  'wood-floor': '0',
  'stone-floor': '1',
  'weathered-floor': '2',
  'crystal-floor': '3',
  'straw-floor': '4',
  'gravel-path': '5',
  'wood-path': '6',
  'crystal-path': '7',
  road: '8',
  'steppingstone-path': '9',
  'brick-floor': '10',
  'rustic-plank-floor': '11',
  'stone-walkway': '12',
};

/** Sprites attached to other items rather than placed on their own. */
const EXTRAS: Record<string, { texture: string }> = {
  mailbox: { texture: 'Mailbox' },
};

/**
 * The ground under and around the greenhouse, which the game sets in code (GreenhouseBuilding)
 * rather than in data. It draws a stone path on the 3x2 doorstep below its door, and a shadow
 * reaching one tile left of its footprint and two rows below it. doesTileHaveProperty makes the
 * doorstep unbuildable and untillable, and the rest of that area buildable but untillable.
 */
function greenhouseGround(data: BuildingData): {
  ground: GroundEffect[];
  background: (season: MapSeason) => Image;
} {
  const { X: width, Y: height } = data.Size;
  const door = data.HumanDoor!;
  const ground: GroundEffect[] = [
    {
      x: door.X - 1,
      y: door.Y + 1,
      width: 3,
      height: height + 1 - door.Y,
      buildable: false,
      tillable: false,
    },
    { x: -1, y: 0, width: width + 1, height: height + 1, buildable: true, tillable: false },
    { x: 1, y: height + 1, width: width - 2, height: 1, buildable: true, tillable: false },
  ];
  // DrawEntranceTiles: the season's outdoor tiles 812 (top row) and 838 (bottom row) on the
  // doorstep. Then drawShadow, one tile left of the footprint, with a gap for the path.
  const background = (season: MapSeason) => {
    const image = blank((width + 1) * TILE, 9 * TILE);
    const outdoors = texture(`Maps/${season}_outdoorsTileSheet`);
    const columns = outdoors.width / TILE;
    const tile = (index: number) =>
      crop(outdoors, (index % columns) * TILE, Math.floor(index / columns) * TILE, TILE, TILE);
    for (let i = 0; i < 3; i++) {
      paste(image, tile(812), (door.X + i) * TILE, (door.Y + 1) * TILE);
      paste(image, tile(838), (door.X + i) * TILE, (door.Y + 2) * TILE);
    }
    paste(image, crop(texture('Buildings/Greenhouse'), 112, 144, 128, 144), 0, 0);
    return image;
  };
  return { ground, background };
}

/** Placement rules and ground art for a catalog building, from its game data. */
function buildingRules(
  id: string,
  art: BuildingArt,
  data: BuildingData,
  spriteHeight: number,
  outDir: string,
): BuildingRules {
  const rules: BuildingRules = { floorsUnderneath: data.AllowsFlooringUnderneath ?? true };
  if (data.HumanDoor && data.HumanDoor.X >= 0)
    rules.door = { x: data.HumanDoor.X, y: data.HumanDoor.Y };
  const placement = data.AdditionalPlacementTiles ?? [];
  if (placement.length) {
    rules.placementTiles = placement.map(({ TileArea: a, OnlyNeedsToBePassable }) => ({
      x: a.X,
      y: a.Y,
      width: a.Width,
      height: a.Height,
      passableOnly: OnlyNeedsToBePassable,
    }));
  }
  // Solid tiles of the collision map beyond the footprint (the farmhouse's mailbox).
  const ground: GroundEffect[] = [];
  const rows = (data.CollisionMap ?? '')
    .trim()
    .split('\n')
    .map((row) => row.trim());
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === 'X' && (x >= data.Size.X || y >= data.Size.Y))
        ground.push({ x, y, width: 1, height: 1, solid: true });
    });
  });

  let background: { image: (season: MapSeason) => Image; x: number; y: number } | null = null;
  if (art.building === 'Greenhouse') {
    const greenhouse = greenhouseGround(data);
    ground.push(...greenhouse.ground);
    background = { image: greenhouse.background, x: -TILE, y: 0 };
  }
  // Draw layers the game puts on the ground (the pet bowl's platform), placed from the sprite's top-left.
  for (const layer of data.DrawLayers ?? []) {
    if (!layer.DrawInBackground) continue;
    if (background) throw new Error(`${id} has more than one background`);
    const sheet = texture(
      layer.Texture ?? `Buildings/${art.texture ?? data.Texture.split('\\').pop()!}`,
    );
    const r = layer.SourceRect;
    const [x, y] = layer.DrawPosition.split(',').map((v) => Number(v.trim()));
    background = {
      image: () => crop(sheet, r.X, r.Y, r.Width, r.Height),
      x,
      y: data.Size.Y * TILE - spriteHeight + y,
    };
  }
  if (ground.length) rules.ground = ground;
  if (background) {
    // Named after the texture, so variants that share one (the broken and repaired greenhouse) share the file.
    const name = `${(art.texture ?? art.building).toLowerCase().replace(/\s+/g, '-')}-background`;
    const spring = background.image('spring');
    rules.background = {
      ...seasonal(name, outDir, background.image),
      x: background.x,
      y: background.y,
      width: spring.width,
      height: spring.height,
    };
  }
  return rules;
}

/**
 * Writes art for each season: <name>.png for spring, and <name>-<season>.png for the seasons whose
 * art differs. Returns the files.
 */
function seasonal(
  name: string,
  outDir: string,
  draw: (season: MapSeason) => Image,
): { file: string; seasons?: SeasonalFiles } {
  const spring = encodePng(draw('spring'));
  writeFileSync(join(outDir, `${name}.png`), spring);
  const seasons: SeasonalFiles = {};
  for (const season of SEASONS.slice(1) as Exclude<MapSeason, 'spring'>[]) {
    const png = encodePng(draw(season));
    if (png.equals(spring)) continue;
    seasons[season] = `${name}-${season}.png`;
    writeFileSync(join(outDir, seasons[season]), png);
  }
  return { file: `${name}.png`, ...(Object.keys(seasons).length && { seasons }) };
}

/** A plain data value as a TypeScript literal. */
function literal(value: unknown): string {
  return JSON.stringify(value)
    .replace(/"(\w+)":/g, '$1: ')
    .replace(/,/g, ', ')
    .replace(/{/g, '{ ')
    .replace(/}/g, ' }');
}

const images = new Map<string, Image>();
/** A texture by its content path, e.g. "Buildings/Coop" or "TileSheets\\Craftables". */
function texture(name: string): Image {
  const path = name.replace(/\\/g, '/');
  let image = images.get(path);
  if (!image) {
    image = decodePng(readFileSync(join(content, `${path}.png`)));
    images.set(path, image);
  }
  return image;
}

interface SpriteData {
  Texture?: string | null;
  SpriteIndex: number;
}

function main() {
  const buildings = JSON.parse(
    readFileSync(join(content, 'Data', 'Buildings.json'), 'utf8'),
  ) as Record<string, BuildingData>;
  const outDir = join(ROOT, 'public/assets/game');
  mkdirSync(outDir, { recursive: true });

  const entries: string[] = [];
  const rules: string[] = [];
  for (const [id, art] of Object.entries(BUILDINGS)) {
    const data = buildings[art.building];
    if (!data) throw new Error(`Data/Buildings.json has no "${art.building}"`);
    const textureName = art.texture ?? data.Texture.split('\\').pop()!;
    const sheet = texture(`Buildings/${textureName}`);
    // An empty SourceRect means the footprint's width and the texture's full height.
    const own = data.SourceRect && data.SourceRect.Width > 0 ? data.SourceRect : null;
    const rect =
      art.rect ??
      (own
        ? { x: own.X, y: own.Y, width: own.Width, height: own.Height }
        : { x: 0, y: 0, width: data.Size.X * TILE, height: sheet.height });
    const [offsetX, offsetY] = (data.DrawOffset ?? '0, 0').split(',').map((v) => Number(v.trim()));
    const file = `${id}.png`;
    writeFileSync(
      join(outDir, file),
      encodePng(crop(sheet, rect.x, rect.y, rect.width, rect.height)),
    );
    entries.push(
      `  ${JSON.stringify(id)}: { file: ${JSON.stringify(file)}, width: ${rect.width}, height: ${rect.height}, offsetX: ${offsetX}, offsetY: ${offsetY}, footprint: { width: ${data.Size.X}, height: ${data.Size.Y} } },`,
    );
    rules.push(
      `  ${JSON.stringify(id)}: ${literal(buildingRules(id, art, data, rect.height, outDir))},`,
    );
  }

  const save = (
    id: string,
    sheet: Image,
    rect: Rect,
    footprint: { width: number; height: number },
  ) => {
    const file = `${id}.png`;
    writeFileSync(
      join(outDir, file),
      encodePng(crop(sheet, rect.x, rect.y, rect.width, rect.height)),
    );
    entries.push(
      `  ${JSON.stringify(id)}: { file: ${JSON.stringify(file)}, width: ${rect.width}, height: ${rect.height}, offsetX: 0, offsetY: 0, footprint: { width: ${footprint.width}, height: ${footprint.height} } },`,
    );
  };
  const bigCraftables = JSON.parse(
    readFileSync(join(content, 'Data', 'BigCraftables.json'), 'utf8'),
  ) as Record<string, SpriteData>;
  const objects = JSON.parse(readFileSync(join(content, 'Data', 'Objects.json'), 'utf8')) as Record<
    string,
    SpriteData
  >;
  for (const [id, item] of Object.entries(ITEMS)) {
    // Big craftables are 16x32 and stand on one tile; objects are 16x16.
    const big = 'bigCraftable' in item;
    const key = big ? item.bigCraftable : item.object;
    const data = (big ? bigCraftables : objects)[key];
    if (!data) throw new Error(`No ${big ? 'big craftable' : 'object'} "${key}"`);
    const sheet = texture(data.Texture ?? (big ? 'TileSheets/Craftables' : 'Maps/springobjects'));
    const height = big ? 2 * TILE : TILE;
    const columns = Math.floor(sheet.width / TILE);
    const rect = {
      x: (data.SpriteIndex % columns) * TILE,
      y: Math.floor(data.SpriteIndex / columns) * height,
      width: TILE,
      height,
    };
    save(id, sheet, rect, { width: 1, height: 1 });
  }
  for (const [id, item] of Object.entries(CROPPED))
    save(id, texture(item.texture), item.rect, item.footprint);
  const wildTrees = JSON.parse(
    readFileSync(join(content, 'Data', 'WildTrees.json'), 'utf8'),
  ) as Record<string, { Textures: { Texture: string; Season: string | null }[] }>;
  for (const [id, type] of Object.entries(WILD_TREES)) {
    const textures = wildTrees[type].Textures;
    const art = seasonal(id, outDir, (season) => {
      // A texture for the season, or else the one without a season.
      const name = (
        textures.find((t) => t.Season?.toLowerCase() === season) ?? textures.find((t) => !t.Season)!
      ).Texture;
      const sheet = texture(name);
      const tree = blank(48, 96);
      paste(tree, crop(sheet, 32, 96, 16, 32), 16, 64);
      paste(tree, crop(sheet, 0, 0, 48, 96), 0, 0);
      return tree;
    });
    entries.push(
      `  ${JSON.stringify(id)}: ${literal({ ...art, width: 48, height: 96, offsetX: -16, offsetY: 0, footprint: { width: 1, height: 1 } })},`,
    );
  }
  const fruitTrees = JSON.parse(
    readFileSync(join(content, 'Data', 'FruitTrees.json'), 'utf8'),
  ) as Record<string, { Texture: string; TextureSpriteRow: number }>;
  for (const [id, sapling] of Object.entries(FRUIT_TREES)) {
    const data = fruitTrees[sapling];
    const art = seasonal(id, outDir, (season) =>
      crop(
        texture(data.Texture),
        192 + 48 * SEASONS.indexOf(season),
        data.TextureSpriteRow * 80,
        48,
        80,
      ),
    );
    entries.push(
      `  ${JSON.stringify(id)}: ${literal({ ...art, width: 48, height: 80, offsetX: 0, offsetY: 0, footprint: { width: 3, height: 3 } })},`,
    );
  }

  // Fence and floor sheets, and how each item tiles with its neighbours.
  const tilings: string[] = [];
  const copySheet = (path: string) => {
    const file = `${path.split(/[\\/]/).pop()!.toLowerCase().replace(/_/g, '-')}.png`;
    writeFileSync(join(outDir, file), encodePng(texture(path)));
    return file;
  };
  const fenceData = JSON.parse(
    readFileSync(join(content, 'Data', 'Fences.json'), 'utf8'),
  ) as Record<
    string,
    {
      Texture: string;
      HeldObjectDrawOffset: string;
      LeftEndHeldObjectDrawX: number;
      RightEndHeldObjectDrawX: number;
    }
  >;
  for (const [id, { fence, torch }] of Object.entries(FENCES)) {
    const data = fenceData[fence];
    const [x, y] = data.HeldObjectDrawOffset.split(',').map((v) => Number(v.trim()));
    const tiling: Tiling = {
      kind: 'fence',
      file: copySheet(data.Texture),
      group: fence,
      ...(torch && {
        torch: {
          x,
          y,
          leftEnd: data.LeftEndHeldObjectDrawX,
          rightEnd: data.RightEndHeldObjectDrawX,
        },
      }),
    };
    tilings.push(`  ${JSON.stringify(id)}: ${literal(tiling)},`);
  }
  const floorData = JSON.parse(
    readFileSync(join(content, 'Data', 'FloorsAndPaths.json'), 'utf8'),
  ) as Record<
    string,
    {
      Texture: string;
      Corner: { X: number; Y: number };
      WinterTexture: string;
      WinterCorner: { X: number; Y: number };
      ConnectType: string;
      CornerSize: number;
    }
  >;
  const connects: Record<string, 'default' | 'path' | 'decorated' | 'random'> = {
    Default: 'default',
    Path: 'path',
    CornerDecorated: 'decorated',
    Random: 'random',
  };
  for (const [id, floor] of Object.entries(FLOORS)) {
    const data = floorData[floor];
    const tiling: Tiling = {
      kind: 'floor',
      file: copySheet(data.Texture),
      winterFile: copySheet(data.WinterTexture),
      corner: { x: data.Corner.X, y: data.Corner.Y },
      winterCorner: { x: data.WinterCorner.X, y: data.WinterCorner.Y },
      group: floor,
      connect: connects[data.ConnectType],
      cornerSize: data.CornerSize,
    };
    tilings.push(`  ${JSON.stringify(id)}: ${literal(tiling)},`);
  }

  const extras: string[] = [];
  for (const [id, extra] of Object.entries(EXTRAS)) {
    const image = texture(`Buildings/${extra.texture}`);
    const file = `${id}.png`;
    writeFileSync(join(outDir, file), encodePng(image));
    extras.push(
      `  ${JSON.stringify(id)}: { file: ${JSON.stringify(file)}, width: ${image.width}, height: ${image.height} },`,
    );
  }

  const ts = `// Generated by scripts/import-game.mts from the unpacked game content. Do not edit by hand.
// Stardew Valley's art is © ConcernedApe.
import { BuildingRules, GameArt, GameSprite, Tiling } from './game-art';

/** Building, machine, crop and tree art by catalog id. */
export const GAME_ART: Readonly<Record<string, GameArt>> = {
${entries.join('\n')}
};

/** Sprites drawn as parts of other items. */
export const GAME_SPRITES: Readonly<Record<string, GameSprite>> = {
${extras.join('\n')}
};

/** How fences and floors join their neighbours, by catalog id. */
export const TILINGS: Readonly<Record<string, Tiling>> = {
${tilings.join('\n')}
};

/** How each building sits on the farm, by catalog id. */
export const BUILDING_RULES: Readonly<Record<string, BuildingRules>> = {
${rules.join('\n')}
};
`;
  writeFileSync(join(ROOT, 'src/app/core/data/game-art.generated.ts'), ts);
  console.log(
    `Imported ${entries.length} items, ${extras.length} extra sprites and ${rules.length} buildings' rules.`,
  );
}

main();
