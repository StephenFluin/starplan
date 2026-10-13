/**
 * Imports the farm maps from Stardew Valley's own content, unpacked with StardewXnbHack
 * (https://github.com/Pathoschild/StardewXnbHack) from your copy of the game.
 *
 * Usage: node scripts/import-farms.mts "<path to Content (unpacked)>"
 *
 * For each farm type it renders the spring map into public/assets/layouts/<id>.png, derives the
 * placement restrictions from the map's tile properties into public/assets/restrictions/<id>.txt,
 * writes the default building spots to src/app/core/data/farms.generated.ts, and cuts the greenhouse's
 * doorstep path out of the outdoor tilesheet.
 * Stardew Valley's art is © ConcernedApe.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Image, decodePng, encodePng } from './png.mts';

const TILE = 16;
const ROOT = resolve(import.meta.dirname, '..');

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/import-farms.mts "<path to Content (unpacked)>"');
  process.exit(1);
}
const content = resolve(source);

// Same bits as src/app/core/plan/restriction-map.ts.
const IMPASSABLE = 1;
const NOT_BUILDABLE = 2;
const NOT_TILLABLE = 4;

interface Point {
  x: number;
  y: number;
}

interface FarmSpec {
  id: string;
  name: string;
  map: string;
  /** Where the game puts the greenhouse when the map has no GreenhouseLocation property. */
  greenhouse: Point;
  /** Objects and fences the game adds when the farm is created. */
  starter?: { objects: { itemId: string; x: number; y: number }[]; tiles: { itemId: string; x: number; y: number }[] };
}

// The game's defaults (Farm.GetGreenhouseStartLocation and friends), for maps without properties.
const STANDARD_GREENHOUSE = { x: 25, y: 10 };
const DEFAULT_HOUSE_ENTRY = { x: 64, y: 15 };
const DEFAULT_SHIPPING_BIN = { x: 71, y: 14 };
const DEFAULT_PET_BOWL = { x: 53, y: 7 };

/** The Meadowlands Farm starts with a coop in a fenced yard (Farm.onNewGame). */
function meadowlandsStarter(): FarmSpec['starter'] {
  const tiles: { itemId: string; x: number; y: number }[] = [];
  const objects = [{ itemId: 'coop', x: 54, y: 9 }];
  for (let x = 47; x < 63; x++) tiles.push({ itemId: 'fence', x, y: 20 });
  for (let y = 16; y < 20; y++) tiles.push({ itemId: 'fence', x: 47, y });
  for (let y = 7; y < 20; y++) {
    if (y === 13) objects.push({ itemId: 'gate', x: 62, y });
    else tiles.push({ itemId: 'fence', x: 62, y });
  }
  return { objects, tiles };
}

const FARMS: FarmSpec[] = [
  { id: 'regular', name: 'Standard Farm', map: 'Farm', greenhouse: STANDARD_GREENHOUSE },
  { id: 'fishing', name: 'Riverland Farm', map: 'Farm_Fishing', greenhouse: STANDARD_GREENHOUSE },
  { id: 'foraging', name: 'Forest Farm', map: 'Farm_Foraging', greenhouse: STANDARD_GREENHOUSE },
  { id: 'mining', name: 'Hill-top Farm', map: 'Farm_Mining', greenhouse: STANDARD_GREENHOUSE },
  { id: 'combat', name: 'Wilderness Farm', map: 'Farm_Combat', greenhouse: STANDARD_GREENHOUSE },
  { id: 'fourcorners', name: 'Four Corners Farm', map: 'Farm_FourCorners', greenhouse: { x: 36, y: 29 } },
  { id: 'beach', name: 'Beach Farm', map: 'Farm_Island', greenhouse: { x: 14, y: 14 } },
  { id: 'ranching', name: 'Meadowlands Farm', map: 'Farm_Ranching', greenhouse: STANDARD_GREENHOUSE, starter: meadowlandsStarter() },
];

// --- TMX parsing -----------------------------------------------------------------------------

type Props = Record<string, string>;

interface Tileset {
  firstGid: number;
  image: Image;
  columns: number;
  props: Map<number, Props>;
}

interface Layer {
  name: string;
  visible: boolean;
  gids: number[];
}

interface TmxMap {
  width: number;
  height: number;
  props: Props;
  tilesets: Tileset[];
  layers: Layer[];
  /** Per-layer tile properties set with "TileData" objects, keyed by "x,y". */
  tileData: Map<string, Map<string, Props>>;
}

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;

function attrs(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.matchAll(/([\w-]+)="([^"]*)"/g)) result[match[1]] = decodeXml(match[2]);
  return result;
}

function decodeXml(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function properties(text: string | undefined): Props {
  const result: Props = {};
  const block = text?.match(/<properties>([\s\S]*?)<\/properties>/)?.[1] ?? '';
  for (const match of block.matchAll(/<property\b([^>]*?)\/?>/g)) {
    const { name, value } = attrs(match[1]);
    if (name) result[name] = value ?? '';
  }
  return result;
}

const sheets = new Map<string, Image>();
function sheet(name: string): Image {
  let image = sheets.get(name);
  if (!image) {
    image = decodePng(readFileSync(join(content, 'Maps', `${name}.png`)));
    sheets.set(name, image);
  }
  return image;
}

function readMap(name: string): TmxMap {
  const xml = readFileSync(join(content, 'Maps', `${name}.tmx`), 'utf8');
  const head = attrs(xml.match(/<map\b([^>]*)>/)![1]);
  const mapProps = properties(xml.slice(0, xml.indexOf('<tileset')));

  const tilesets: Tileset[] = [];
  for (const match of xml.matchAll(/<tileset\b([^>]*)>([\s\S]*?)<\/tileset>/g)) {
    const info = attrs(match[1]);
    const imageInfo = attrs(match[2].match(/<image\b([^>]*)\/?>/)![1]);
    const image = sheet(imageInfo.source.replace(/\.png$/, ''));
    const props = new Map<number, Props>();
    for (const tile of match[2].matchAll(/<tile\b([^>]*)>([\s\S]*?)<\/tile>/g)) {
      const tileProps = properties(tile[2]);
      if (Object.keys(tileProps).length) props.set(Number(attrs(tile[1]).id), tileProps);
    }
    tilesets.push({ firstGid: Number(info.firstgid), image, columns: Math.floor(image.width / TILE), props });
  }
  tilesets.sort((a, b) => b.firstGid - a.firstGid);

  const layers: Layer[] = [];
  for (const match of xml.matchAll(/<layer\b([^>]*)>([\s\S]*?)<\/layer>/g)) {
    const info = attrs(match[1]);
    const data = match[2].match(/<data encoding="csv">([\s\S]*?)<\/data>/)![1];
    layers.push({ name: info.name, visible: info.visible !== '0', gids: data.split(',').map((v) => Number(v.trim())) });
  }

  const tileData = new Map<string, Map<string, Props>>();
  for (const match of xml.matchAll(/<objectgroup\b([^>]*)>([\s\S]*?)<\/objectgroup>/g)) {
    const layer = attrs(match[1]).name;
    const byTile = new Map<string, Props>();
    for (const object of match[2].matchAll(/<object\b([^>]*?)(?:\/>|>([\s\S]*?)<\/object>)/g)) {
      const info = attrs(object[1]);
      if (info.name !== 'TileData' && info.type !== 'TileData') continue;
      const x = Math.floor(Number(info.x) / TILE);
      const y = Math.floor(Number(info.y) / TILE);
      byTile.set(`${x},${y}`, properties(object[2]));
    }
    tileData.set(layer, byTile);
  }

  return { width: Number(head.width), height: Number(head.height), props: mapProps, tilesets, layers, tileData };
}

function tilesetFor(map: TmxMap, gid: number): Tileset | undefined {
  return map.tilesets.find((t) => gid >= t.firstGid);
}

/** The tile on a layer and its properties: its tileset's, overridden by any TileData object there. */
function tileAt(map: TmxMap, layerName: string, x: number, y: number): { gid: number; props: Props } {
  const layer = map.layers.find((l) => l.name === layerName);
  const gid = (layer?.gids[y * map.width + x] ?? 0) & ~(FLIP_H | FLIP_V | FLIP_D);
  const set = gid ? tilesetFor(map, gid) : undefined;
  const own = set?.props.get(gid - set.firstGid);
  return { gid, props: { ...own, ...map.tileData.get(layerName)?.get(`${x},${y}`) } };
}

// --- Rendering -------------------------------------------------------------------------------

function render(map: TmxMap): Image {
  const out: Image = { width: map.width * TILE, height: map.height * TILE, data: new Uint8Array(map.width * map.height * TILE * TILE * 4) };
  for (const layer of map.layers) {
    // "Paths" holds invisible markers (spawns, trees); the game never draws it.
    if (!layer.visible || layer.name.startsWith('Paths')) continue;
    for (let i = 0; i < layer.gids.length; i++) {
      const raw = layer.gids[i];
      const gid = raw & ~(FLIP_H | FLIP_V | FLIP_D);
      if (!gid) continue;
      const set = tilesetFor(map, gid);
      if (!set) continue;
      const index = gid - set.firstGid;
      drawTile(out, set, index, (i % map.width) * TILE, Math.floor(i / map.width) * TILE, raw);
    }
  }
  return out;
}

function drawTile(out: Image, set: Tileset, index: number, dx: number, dy: number, flags: number): void {
  const sx = (index % set.columns) * TILE;
  const sy = Math.floor(index / set.columns) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let u = x;
      let v = y;
      if (flags & FLIP_D) [u, v] = [v, u];
      if (flags & FLIP_H) u = TILE - 1 - u;
      if (flags & FLIP_V) v = TILE - 1 - v;
      const s = ((sy + v) * set.image.width + sx + u) * 4;
      const alpha = set.image.data[s + 3] / 255;
      if (!alpha) continue;
      const d = ((dy + y) * out.width + dx + x) * 4;
      for (let c = 0; c < 3; c++) out.data[d + c] = Math.round(set.image.data[s + c] * alpha + out.data[d + c] * (1 - alpha));
      out.data[d + 3] = Math.max(out.data[d + 3], set.image.data[s + 3]);
    }
  }
}

// --- Restrictions ----------------------------------------------------------------------------

const isTrue = (value: string | undefined) => value !== undefined && /^(t|true)$/i.test(value);
const isFalse = (value: string | undefined) => value !== undefined && /^(f|false)$/i.test(value);

/**
 * Mirrors the game's placement checks: water and Buildings-layer tiles (unless marked Passable)
 * block everything; buildings need ground marked Buildable, or diggable ground not marked
 * otherwise; crops need Diggable ground.
 */
function restrictions(map: TmxMap): Uint8Array {
  const mask = new Uint8Array(map.width * map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const back = tileAt(map, 'Back', x, y);
      const building = tileAt(map, 'Buildings', x, y);
      const blocked =
        !back.gid || back.props['Water'] !== undefined || isFalse(back.props['Passable']) || (building.gid > 0 && building.props['Passable'] === undefined);
      const diggable = back.props['Diggable'] !== undefined;
      const buildable = !blocked && !isFalse(back.props['Buildable']) && (isTrue(back.props['Buildable']) || diggable);
      let bits = 0;
      if (blocked) bits |= IMPASSABLE | NOT_BUILDABLE | NOT_TILLABLE;
      if (!buildable) bits |= NOT_BUILDABLE;
      if (!diggable) bits |= NOT_TILLABLE;
      mask[y * map.width + x] = bits;
    }
  }
  return mask;
}

function encodeMask(mask: Uint8Array): string {
  let out = '';
  for (let i = 0; i < mask.length; ) {
    let run = 1;
    while (i + run < mask.length && mask[i + run] === mask[i]) run++;
    out += `${run}${String.fromCharCode(97 + mask[i])}`;
    i += run;
  }
  return out;
}

/**
 * The stone path the game lays in front of the greenhouse door: its 3x2 doorstep, tiles 812 (top
 * row) and 838 (bottom row) of the outdoor tilesheet. Drawn with the greenhouse so it moves with it.
 */
function greenhouseDoorstep(): Image {
  const set: Tileset = { firstGid: 0, image: sheet('spring_outdoorsTileSheet'), columns: 0, props: new Map() };
  set.columns = Math.floor(set.image.width / TILE);
  const out: Image = { width: 3 * TILE, height: 2 * TILE, data: new Uint8Array(3 * TILE * 2 * TILE * 4) };
  for (let x = 0; x < 3; x++) {
    drawTile(out, set, 812, x * TILE, 0, 0);
    drawTile(out, set, 838, x * TILE, TILE, 0);
  }
  return out;
}

// --- Output ----------------------------------------------------------------------------------

function point(map: TmxMap, property: string, fallback: Point): Point {
  const value = map.props[property]?.trim().split(/\s+/).map(Number);
  return value && value.length >= 2 && value.every(Number.isFinite) ? { x: value[0], y: value[1] } : fallback;
}

const tsPoint = (p: Point) => `{ x: ${p.x}, y: ${p.y} }`;

function main() {
  const layoutDir = join(ROOT, 'public/assets/layouts');
  const maskDir = join(ROOT, 'public/assets/restrictions');
  mkdirSync(layoutDir, { recursive: true });
  mkdirSync(maskDir, { recursive: true });

  writeFileSync(join(ROOT, 'public/assets/game/greenhouse-doorstep.png'), encodePng(greenhouseDoorstep()));

  const entries: string[] = [];
  for (const farm of FARMS) {
    const map = readMap(farm.map);
    writeFileSync(join(layoutDir, `${farm.id}.png`), encodePng(render(map)));
    writeFileSync(join(maskDir, `${farm.id}.txt`), encodeMask(restrictions(map)));

    // The farmhouse door is 5 tiles in and 2 down from its footprint corner; the entry is below it.
    const entry = point(map, 'FarmHouseEntry', DEFAULT_HOUSE_ENTRY);
    const house = { x: entry.x - 5, y: entry.y - 3 };
    const greenhouse = point(map, 'GreenhouseLocation', farm.greenhouse);
    // Layouts store the farmhouse and greenhouse by sprite corner, four rows above the footprint.
    const fields = [
      `id: ${JSON.stringify(farm.id)}`,
      `name: ${JSON.stringify(farm.name)}`,
      `image: ${JSON.stringify(`${farm.id}.png`)}`,
      `width: ${map.width}`,
      `height: ${map.height}`,
      `kind: "farm"`,
      `restrictions: true`,
      `house: ${tsPoint({ x: house.x, y: house.y - 4 })}`,
      `greenhouse: ${tsPoint({ x: greenhouse.x, y: greenhouse.y - 4 })}`,
      `shippingBin: ${tsPoint(point(map, 'ShippingBinLocation', DEFAULT_SHIPPING_BIN))}`,
      `petBowl: ${tsPoint(point(map, 'PetBowlLocation', DEFAULT_PET_BOWL))}`,
    ];
    if (farm.starter) {
      const list = (items: { itemId: string; x: number; y: number }[]) =>
        `[${items.map((i) => `{ itemId: ${JSON.stringify(i.itemId)}, x: ${i.x}, y: ${i.y} }`).join(', ')}]`;
      fields.push(`starter: { objects: ${list(farm.starter.objects)}, tiles: ${list(farm.starter.tiles)} }`);
    }
    entries.push(`  {\n    ${fields.join(',\n    ')},\n  }`);
    console.log(`${farm.id}: ${map.width}x${map.height}`);
  }

  const ts = `// Generated by scripts/import-farms.mts from the unpacked game content. Do not edit by hand.
// Stardew Valley's art is © ConcernedApe.
import { LayoutInfo } from './layout-info';

/** The game's farm types, rendered from its own maps. */
export const FARM_LAYOUTS: readonly LayoutInfo[] = [
${entries.join(',\n')},
];
`;
  writeFileSync(join(ROOT, 'src/app/core/data/farms.generated.ts'), ts);
}

main();
