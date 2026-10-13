/**
 * Imports building art and footprints from Stardew Valley's own content, unpacked with
 * StardewXnbHack (https://github.com/Pathoschild/StardewXnbHack) from your copy of the game.
 *
 * Usage: node scripts/import-game.mts "<path to Content (unpacked)>"
 *
 * Writes cropped building, machine, crop and tree sprites to public/assets/game/ and their draw metadata to
 * src/app/core/data/game-art.generated.ts. Stardew Valley's art is © ConcernedApe.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Image, crop, decodePng, encodePng } from './png.mts';

const TILE = 16;
const ROOT = resolve(import.meta.dirname, '..');

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/import-game.mts "<path to Content (unpacked)>"');
  process.exit(1);
}
const content = resolve(source);

interface BuildingData {
  Texture: string;
  Size: { X: number; Y: number };
  SourceRect?: { X: number; Y: number; Width: number; Height: number };
  DrawOffset?: string;
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

/** Items cropped from a texture by hand: giant crops (Data/GiantCrops.json) and wild trees (Data/WildTrees.json). */
const CROPPED: Record<string, { texture: string; rect: Rect; footprint: { width: number; height: number } }> = {
  // Giant crops draw one row above their 3x3 footprint.
  'giant-powdermelon': { texture: 'LooseSprites/Cursors_1_6', rect: { x: 320, y: 448, width: 48, height: 64 }, footprint: { width: 3, height: 3 } },
  'giant-qi-fruit': { texture: 'LooseSprites/Cursors_1_6', rect: { x: 368, y: 448, width: 48, height: 64 }, footprint: { width: 3, height: 3 } },
  // A grown wild tree is the top-left 48x96 of its sheet, trunk included.
  'palm-tree': { texture: 'TerrainFeatures/tree_palm', rect: { x: 0, y: 0, width: 48, height: 96 }, footprint: { width: 3, height: 3 } },
  'island-palm-tree': { texture: 'TerrainFeatures/tree_palm2', rect: { x: 0, y: 0, width: 48, height: 96 }, footprint: { width: 3, height: 3 } },
  'mossy-oak-tree': { texture: 'TerrainFeatures/tree1_greenRain', rect: { x: 0, y: 0, width: 48, height: 96 }, footprint: { width: 3, height: 3 } },
  'mossy-maple-tree': { texture: 'TerrainFeatures/tree2_greenRain', rect: { x: 0, y: 0, width: 48, height: 96 }, footprint: { width: 3, height: 3 } },
  'mossy-pine-tree': { texture: 'TerrainFeatures/tree3_greenRain', rect: { x: 0, y: 0, width: 48, height: 96 }, footprint: { width: 3, height: 3 } },
  'mystic-tree': { texture: 'TerrainFeatures/mystic_tree', rect: { x: 0, y: 0, width: 48, height: 96 }, footprint: { width: 3, height: 3 } },
};

/** Sprites attached to other items rather than placed on their own. */
const EXTRAS: Record<string, { texture: string }> = {
  mailbox: { texture: 'Mailbox' },
};

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
  const buildings = JSON.parse(readFileSync(join(content, 'Data', 'Buildings.json'), 'utf8')) as Record<string, BuildingData>;
  const outDir = join(ROOT, 'public/assets/game');
  mkdirSync(outDir, { recursive: true });

  const entries: string[] = [];
  for (const [id, art] of Object.entries(BUILDINGS)) {
    const data = buildings[art.building];
    if (!data) throw new Error(`Data/Buildings.json has no "${art.building}"`);
    const textureName = art.texture ?? data.Texture.split('\\').pop()!;
    const sheet = texture(`Buildings/${textureName}`);
    // An empty SourceRect means the footprint's width and the texture's full height.
    const own = data.SourceRect && data.SourceRect.Width > 0 ? data.SourceRect : null;
    const rect = art.rect ?? (own ? { x: own.X, y: own.Y, width: own.Width, height: own.Height } : { x: 0, y: 0, width: data.Size.X * TILE, height: sheet.height });
    const [offsetX, offsetY] = (data.DrawOffset ?? '0, 0').split(',').map((v) => Number(v.trim()));
    const file = `${id}.png`;
    writeFileSync(join(outDir, file), encodePng(crop(sheet, rect.x, rect.y, rect.width, rect.height)));
    entries.push(
      `  ${JSON.stringify(id)}: { file: ${JSON.stringify(file)}, width: ${rect.width}, height: ${rect.height}, offsetX: ${offsetX}, offsetY: ${offsetY}, footprint: { width: ${data.Size.X}, height: ${data.Size.Y} } },`,
    );
  }

  const save = (id: string, sheet: Image, rect: Rect, footprint: { width: number; height: number }) => {
    const file = `${id}.png`;
    writeFileSync(join(outDir, file), encodePng(crop(sheet, rect.x, rect.y, rect.width, rect.height)));
    entries.push(
      `  ${JSON.stringify(id)}: { file: ${JSON.stringify(file)}, width: ${rect.width}, height: ${rect.height}, offsetX: 0, offsetY: 0, footprint: { width: ${footprint.width}, height: ${footprint.height} } },`,
    );
  };
  const bigCraftables = JSON.parse(readFileSync(join(content, 'Data', 'BigCraftables.json'), 'utf8')) as Record<string, SpriteData>;
  const objects = JSON.parse(readFileSync(join(content, 'Data', 'Objects.json'), 'utf8')) as Record<string, SpriteData>;
  for (const [id, item] of Object.entries(ITEMS)) {
    // Big craftables are 16x32 and stand on one tile; objects are 16x16.
    const big = 'bigCraftable' in item;
    const key = big ? item.bigCraftable : item.object;
    const data = (big ? bigCraftables : objects)[key];
    if (!data) throw new Error(`No ${big ? 'big craftable' : 'object'} "${key}"`);
    const sheet = texture(data.Texture ?? (big ? 'TileSheets/Craftables' : 'Maps/springobjects'));
    const height = big ? 2 * TILE : TILE;
    const columns = Math.floor(sheet.width / TILE);
    const rect = { x: (data.SpriteIndex % columns) * TILE, y: Math.floor(data.SpriteIndex / columns) * height, width: TILE, height };
    save(id, sheet, rect, { width: 1, height: 1 });
  }
  for (const [id, item] of Object.entries(CROPPED)) save(id, texture(item.texture), item.rect, item.footprint);

  const extras: string[] = [];
  for (const [id, extra] of Object.entries(EXTRAS)) {
    const image = texture(`Buildings/${extra.texture}`);
    const file = `${id}.png`;
    writeFileSync(join(outDir, file), encodePng(image));
    extras.push(`  ${JSON.stringify(id)}: { file: ${JSON.stringify(file)}, width: ${image.width}, height: ${image.height} },`);
  }

  const ts = `// Generated by scripts/import-game.mts from the unpacked game content. Do not edit by hand.
// Stardew Valley's art is © ConcernedApe.
import { GameArt, GameSprite } from './game-art';

/** Building, machine, crop and tree art by catalog id. */
export const GAME_ART: Readonly<Record<string, GameArt>> = {
${entries.join('\n')}
};

/** Sprites drawn as parts of other items. */
export const GAME_SPRITES: Readonly<Record<string, GameSprite>> = {
${extras.join('\n')}
};
`;
  writeFileSync(join(ROOT, 'src/app/core/data/game-art.generated.ts'), ts);
  console.log(`Imported ${entries.length} items and ${extras.length} extra sprites.`);
}

main();
