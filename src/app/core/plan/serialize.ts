import { findItem, variantsOf } from '../data/catalog';
import { LayoutInfo, TilePoint } from '../data/layout-info';
import { greenhouseStart, isGreenhouse, legacySpriteOffset } from './default-buildings';
import { Patch, PlacedObject, PlanDocument, emptyPatch, parseKey } from './plan-document';

/**
 * Persisted, versioned plan format.
 * v1: farmhouse and greenhouse positions are the sprite's top-left corner (as in the v2 planner).
 * v2: object positions are the footprint's top-left corner, with a 9x6 farmhouse footprint.
 * v3: as v2, with the game's 9x5 farmhouse footprint (one row lower).
 * v4: as v3, with the pet bowl as an object (older farm images had it painted in).
 */
export interface SavedPlan {
  v: 1 | 2 | 3 | 4;
  layout: string;
  /** itemId -> flat [x0, y0, x1, y1, ...] tile coordinates. */
  tiles: Record<string, number[]>;
  /** [itemId, x, y] per object. */
  objects: [string, number, number][];
  /** Whether the greenhouse has left its start location (PlanDocument.greenhouseMoved). */
  greenhouseMoved?: true;
}

export function toSaved(layout: string, doc: PlanDocument): SavedPlan {
  const tiles: Record<string, number[]> = {};
  for (const [cell, itemId] of doc.allTiles()) {
    const [x, y] = parseKey(cell);
    (tiles[itemId] ??= []).push(x, y);
  }
  const objects: [string, number, number][] = [];
  for (const obj of doc.allObjects()) {
    objects.push([obj.itemId, obj.x, obj.y]);
  }
  objects.sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  return { v: 4, layout, tiles, objects, ...(doc.greenhouseMoved && { greenhouseMoved: true as const }) };
}

/**
 * Builds a patch that loads a saved plan into an empty document, dropping unknown items. Given the
 * plan's layout, older plans get the pet bowl their farm image used to show as part of the map, and
 * a greenhouse saved away from its start location counts as moved.
 */
export function fromSaved(saved: SavedPlan, doc: PlanDocument, layout?: LayoutInfo): Patch {
  const patch = emptyPatch();
  for (const [itemId, coords] of Object.entries(saved.tiles)) {
    const item = findItem(itemId);
    if (!item) continue;
    for (let i = 0; i + 1 < coords.length; i += 2) {
      patch.tiles.push({ x: coords[i], y: coords[i + 1], before: null, after: item.id });
    }
  }
  for (const [itemId, x, y] of saved.objects) {
    const item = findItem(itemId);
    if (!item) continue;
    const obj: PlacedObject = { uid: doc.allocateUid(), itemId: item.id, x, y: y + migrationOffset(saved.v, item.id) };
    patch.objects.push({ uid: obj.uid, before: null, after: obj });
  }
  if (saved.v < 4 && layout?.petBowl) addPaintedPetBowl(patch, doc, layout.petBowl);
  if (saved.greenhouseMoved || (layout && greenhouseLeftStart(patch, layout))) patch.greenhouseMoved = { before: false, after: true };
  return patch;
}

/** Whether the plan has a greenhouse away from the layout's start location (plans saved before greenhouseMoved existed). */
function greenhouseLeftStart(patch: Patch, layout: LayoutInfo): boolean {
  const start = greenhouseStart(layout);
  const greenhouses = patch.objects.flatMap((change) => (change.after && isGreenhouse(change.after.itemId) ? [change.after] : []));
  return start !== null && greenhouses.length > 0 && !greenhouses.some((obj) => obj.x === start.x && obj.y === start.y);
}

const PET_BOWL_IDS = new Set(variantsOf('pet-bowl').map((item) => item.id));

/** Adds the pet bowl at its default spot, unless the plan has one or something else is there. */
function addPaintedPetBowl(patch: Patch, doc: PlanDocument, at: TilePoint): void {
  const bowl = findItem('pet-bowl');
  if (!bowl) return;
  const objects = patch.objects.flatMap((change) => (change.after ? [change.after] : []));
  if (objects.some((obj) => PET_BOWL_IDS.has(obj.itemId))) return;
  const overlaps = objects.some((obj) => {
    const item = findItem(obj.itemId);
    return item && obj.x < at.x + bowl.width && at.x < obj.x + item.width && obj.y < at.y + bowl.height && at.y < obj.y + item.height;
  });
  if (overlaps) return;
  const obj: PlacedObject = { uid: doc.allocateUid(), itemId: bowl.id, x: at.x, y: at.y };
  patch.objects.push({ uid: obj.uid, before: null, after: obj });
}

/** Rows to move an object down when loading an older plan version. */
function migrationOffset(version: SavedPlan['v'], itemId: string): number {
  // v1 stored the farmhouse and greenhouse by sprite corner.
  if (version === 1) return legacySpriteOffset(itemId);
  // v2's farmhouse footprint was 9x6, one row taller than the game's.
  if (version === 2) return variantsOf('house').some((v) => v.id === itemId) ? 1 : 0;
  return 0;
}

export function isSavedPlan(value: unknown): value is SavedPlan {
  if (typeof value !== 'object' || value === null) return false;
  const plan = value as Partial<SavedPlan>;
  return (plan.v === 1 || plan.v === 2 || plan.v === 3 || plan.v === 4) && typeof plan.layout === 'string' && typeof plan.tiles === 'object' && Array.isArray(plan.objects);
}

interface V2Plan {
  tiles?: { type: string; x: number | string; y: number | string }[];
  buildings?: { type: string; x: number | string; y: number | string }[];
  options?: { layout?: string };
}

/** Converts a plan exported from the v2 planner (pixel coordinates) into the current format. */
export function fromV2(value: unknown): SavedPlan | null {
  if (typeof value !== 'object' || value === null) return null;
  const v2 = value as V2Plan;
  if (!Array.isArray(v2.tiles) && !Array.isArray(v2.buildings)) return null;
  const saved: SavedPlan = { v: 1, layout: v2.options?.layout ?? 'regular', tiles: {}, objects: [] };
  for (const tile of v2.tiles ?? []) {
    const item = findItem(tile.type);
    if (!item) continue;
    const coords = [Math.floor(Number(tile.x) / 16), Math.floor(Number(tile.y) / 16)];
    if (item.kind === 'tile') {
      (saved.tiles[item.id] ??= []).push(...coords);
    } else {
      saved.objects.push([item.id, coords[0], coords[1]]);
    }
  }
  for (const building of v2.buildings ?? []) {
    const item = findItem(building.type);
    if (!item) continue;
    saved.objects.push([item.id, Math.floor(Number(building.x) / 16), Math.floor(Number(building.y) / 16)]);
  }
  return saved;
}

export interface ParsedPlan {
  plan: SavedPlan;
  /** True for v2 planner files, which don't include the layout's default buildings. */
  legacy: boolean;
}

/** Parses JSON in either the current or the v2 format. */
export function parsePlanJson(text: string): ParsedPlan | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (isSavedPlan(value)) return { plan: value, legacy: false };
  const plan = fromV2(value);
  return plan ? { plan, legacy: true } : null;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Response(bytes as BodyInit).body;
  if (!body) throw new Error('Streams are not supported');
  return new Uint8Array(await new Response(body.pipeThrough(stream)).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Compresses a plan into a URL-safe string for share links. */
export async function encodePlan(plan: SavedPlan): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(plan));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodePlan(encoded: string): Promise<SavedPlan | null> {
  try {
    const bytes = await pipe(fromBase64Url(encoded), new DecompressionStream('deflate-raw'));
    return parsePlanJson(new TextDecoder().decode(bytes))?.plan ?? null;
  } catch {
    return null;
  }
}
