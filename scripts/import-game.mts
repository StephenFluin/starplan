/**
 * Imports building art and footprints from Stardew Valley's own content, unpacked with
 * StardewXnbHack (https://github.com/Pathoschild/StardewXnbHack) from your copy of the game.
 *
 * Usage: node scripts/import-game.mts "<path to Content (unpacked)>"
 *
 * Writes cropped sprites to public/assets/game/ and their draw metadata to
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

/** Sprites attached to other items rather than placed on their own. */
const EXTRAS: Record<string, { texture: string }> = {
  mailbox: { texture: 'Mailbox' },
};

const images = new Map<string, Image>();
function texture(name: string): Image {
  let image = images.get(name);
  if (!image) {
    image = decodePng(readFileSync(join(content, 'Buildings', `${name}.png`)));
    images.set(name, image);
  }
  return image;
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
    const sheet = texture(textureName);
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

  const extras: string[] = [];
  for (const [id, extra] of Object.entries(EXTRAS)) {
    const image = texture(extra.texture);
    const file = `${id}.png`;
    writeFileSync(join(outDir, file), encodePng(image));
    extras.push(`  ${JSON.stringify(id)}: { file: ${JSON.stringify(file)}, width: ${image.width}, height: ${image.height} },`);
  }

  const ts = `// Generated by scripts/import-game.mts from the unpacked game content. Do not edit by hand.
// Stardew Valley's art is © ConcernedApe.
import { GameArt, GameSprite } from './game-art';

/** Building art by catalog id. */
export const GAME_ART: Readonly<Record<string, GameArt>> = {
${entries.join('\n')}
};

/** Sprites drawn as parts of other items. */
export const GAME_SPRITES: Readonly<Record<string, GameSprite>> = {
${extras.join('\n')}
};
`;
  writeFileSync(join(ROOT, 'src/app/core/data/game-art.generated.ts'), ts);
  console.log(`Imported ${entries.length} buildings and ${extras.length} extra sprites.`);
}

main();
