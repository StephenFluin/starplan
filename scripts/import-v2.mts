/**
 * Imports sprites, farm layouts and restriction maps from a checkout of the
 * Apache-2.0 licensed v2 planner (https://github.com/hpeinar/stardewplanner).
 *
 * Usage: node scripts/import-v2.mts <path-to-stardewplanner-checkout> [--mods]
 *
 * --mods also imports community (modded) farm layouts that ship restriction data.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

interface V2Layout {
  name: string;
  backgroundImage: string;
  official?: boolean;
  prettyName?: string;
  author?: string;
  url?: string;
  house?: { x: number; y: number };
  greenhouse?: { x: number; y: number };
  width: number;
  height: number;
}

type V2Layer = Record<string, { Tiles: string[] }>;

const TILE = 16;
const ROOT = resolve(import.meta.dirname, '..');

const [source, ...flags] = process.argv.slice(2);
if (!source) {
  console.error('Usage: node scripts/import-v2.mts <path-to-stardewplanner-checkout> [--mods]');
  process.exit(1);
}
const includeMods = flags.includes('--mods');
const planner = join(resolve(source), 'public/planner');

const OFFICIAL_NAMES: Record<string, string> = {
  regular: 'Standard Farm',
  combat: 'Wilderness Farm',
  fishing: 'Riverland Farm',
  foraging: 'Forest Farm',
  mining: 'Hill-top Farm',
  ranching: 'Meadowlands Farm',
  beach: 'Beach Farm',
  fourcorners: 'Four Corners Farm',
  ginger_island: 'Ginger Island Farm',
  quarry: 'Quarry',
  greenhouse: 'Greenhouse',
  barn: 'Barn',
  'barn-big': 'Big Barn',
  'barn-deluxe': 'Deluxe Barn',
  coop: 'Coop',
  'coop-big': 'Big Coop',
  'coop-deluxe': 'Deluxe Coop',
  shed: 'Shed',
  'shed-big': 'Big Shed',
};

/**
 * The standard-size farm images paint the farmhouse foundation, mailbox and shipping bin into the
 * background at the same spots (relative to the farmhouse at 59,8). These get covered up and
 * recreated as objects so they can move.
 */
const STANDARD_BAKED = {
  groundSample: '{ x: 61, y: 10 }',
  house: '{ x: 60, y: 12, width: 7, height: 5 }',
  mailbox: '{ x: 68, y: 15, width: 1, height: 2 }',
  bin: '{ x: 71, y: 13, width: 2, height: 2 }',
};
const BAKED_WITH_BIN = new Set(['regular', 'combat', 'fishing', 'foraging', 'mining', 'fourcorners']);
const BAKED_WITHOUT_BIN = new Set(['beach']);

function bakedFields(id: string): string[] {
  const withBin = BAKED_WITH_BIN.has(id);
  if (!withBin && !BAKED_WITHOUT_BIN.has(id)) return [];
  const cover = [STANDARD_BAKED.house, STANDARD_BAKED.mailbox, ...(withBin ? [STANDARD_BAKED.bin] : [])];
  const fields = [
    `baked: { groundSample: ${STANDARD_BAKED.groundSample}, cover: [${cover.join(', ')}] }`,
  ];
  if (withBin) fields.unshift('shippingBin: { x: 71, y: 14 }');
  return fields;
}

const INTERIORS = new Set(['greenhouse', 'barn', 'barn-big', 'barn-deluxe', 'coop', 'coop-big', 'coop-deluxe', 'shed', 'shed-big']);

// Restriction bits, run-length encoded as "<count><letter>" where a=0, b=1, ... h=7.
const IMPASSABLE = 1;
const NOT_BUILDABLE = 2;
const NOT_TILLABLE = 4;

function loadLayouts(): Record<string, V2Layout> {
  const src = readFileSync(join(planner, 'js/data/layouts.js'), 'utf8');
  return new Function(`${src};return layouts;`)() as Record<string, V2Layout>;
}

function readLayer(name: string, kind: string): V2Layer | null {
  const file = join(planner, 'js/data/layer-information', `${name}_${kind}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as V2Layer) : null;
}

/** Builds a run-length encoded restriction mask. */
function buildMask(name: string, width: number, height: number): string | null {
  const accessible = readLayer(name, 'accessible');
  const buildable = readLayer(name, 'buildable');
  const tillable = readLayer(name, 'tillable');
  if (!accessible || !buildable || !tillable) {
    return null;
  }
  const mask = new Uint8Array(width * height);
  const mark = (tiles: string[] | undefined, bit: number) => {
    for (const tile of tiles ?? []) {
      const [x, y] = tile.split(',').map((v) => Number(v.trim()));
      if (x >= 0 && y >= 0 && x < width && y < height) {
        mask[y * width + x] |= bit;
      }
    }
  };
  mark(accessible['accessible.impassable']?.Tiles, IMPASSABLE | NOT_BUILDABLE | NOT_TILLABLE);
  mark(buildable['buildable.not-buildable']?.Tiles, NOT_BUILDABLE);
  mark(tillable['tillable.not-tillable']?.Tiles, NOT_TILLABLE);
  mark(tillable['tillable.occupied']?.Tiles, NOT_TILLABLE);

  let out = '';
  for (let i = 0; i < mask.length; ) {
    let run = 1;
    while (i + run < mask.length && mask[i + run] === mask[i]) run++;
    out += `${run}${String.fromCharCode(97 + mask[i])}`;
    i += run;
  }
  return out;
}

function main() {
  const spriteDir = join(ROOT, 'public/assets/sprites');
  const layoutDir = join(ROOT, 'public/assets/layouts');
  const maskDir = join(ROOT, 'public/assets/restrictions');
  for (const dir of [spriteDir, layoutDir, maskDir]) mkdirSync(dir, { recursive: true });

  const tiles = readdirSync(join(planner, 'img/tiles')).filter((f) => f.endsWith('.png'));
  for (const file of tiles) {
    copyFileSync(join(planner, 'img/tiles', file), join(spriteDir, file));
  }

  const entries: string[] = [];
  for (const [id, layout] of Object.entries(loadLayouts())) {
    const width = Math.round(layout.width / TILE);
    const height = Math.round(layout.height / TILE);
    const mask = buildMask(id, width, height);
    const official = Boolean(layout.official);
    if (!official && (!includeMods || !mask)) {
      continue;
    }
    const imageSrc = join(planner, 'img/layouts', layout.backgroundImage);
    if (!existsSync(imageSrc)) {
      console.warn(`Skipping ${id}: missing ${layout.backgroundImage}`);
      continue;
    }
    const image = `${id}${extname(layout.backgroundImage)}`;
    copyFileSync(imageSrc, join(layoutDir, image));
    if (mask) {
      writeFileSync(join(maskDir, `${id}.txt`), mask);
    }

    const fields = [
      `id: ${JSON.stringify(id)}`,
      `name: ${JSON.stringify(OFFICIAL_NAMES[id] ?? layout.prettyName ?? id)}`,
      `image: ${JSON.stringify(image)}`,
      `width: ${width}`,
      `height: ${height}`,
      `kind: ${JSON.stringify(INTERIORS.has(id) ? 'interior' : official ? 'farm' : 'community')}`,
      `restrictions: ${Boolean(mask)}`,
    ];
    if (layout.author) fields.push(`author: ${JSON.stringify(layout.author)}`);
    if (layout.url) fields.push(`url: ${JSON.stringify(layout.url)}`);
    if (layout.house) fields.push(`house: { x: ${layout.house.x}, y: ${layout.house.y} }`);
    if (layout.greenhouse) fields.push(`greenhouse: { x: ${layout.greenhouse.x}, y: ${layout.greenhouse.y} }`);
    fields.push(...bakedFields(id));
    entries.push(`  {\n    ${fields.join(',\n    ')},\n  }`);
  }

  const ts = `// Generated by scripts/import-v2.mts from the Apache-2.0 v2 planner. Do not edit by hand.
import { LayoutInfo } from './layout-info';

export const LAYOUTS: readonly LayoutInfo[] = [
${entries.join(',\n')},
];
`;
  writeFileSync(join(ROOT, 'src/app/core/data/layouts.generated.ts'), ts);
  console.log(`Imported ${tiles.length} sprites and ${entries.length} layouts.`);
}

main();
