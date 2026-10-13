import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture, TextureSource, TilingSprite } from 'pixi.js';
import { CATALOG, CatalogItem, RangeGroup, findItem, spriteUrl, variantsOf } from '../../../core/data/catalog';
import { GAME_SPRITES } from '../../../core/data/game-art.generated';
import { LayoutInfo, TilePoint } from '../../../core/data/layout-info';
import { Patch, PlacedObject, PlanDocument, parseKey } from '../../../core/plan/plan-document';
import { TileRect } from '../../../core/plan/placement';
import { rangeTiles } from '../../../core/plan/range';
import { NOT_BUILDABLE, NOT_TILLABLE, RestrictionMap } from '../../../core/plan/restriction-map';
import { RestrictionOverlay } from '../../../core/planner-store';

export const TILE = 16;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

/** What the cursor is about to do, drawn above everything else. */
export interface Preview {
  /** Ghost sprites for objects being placed or moved. */
  ghosts?: { item: CatalogItem; x: number; y: number }[];
  /** Drag rectangle for brushes, the eraser or marquee selection. */
  rect?: TileRect & { style: 'brush' | 'erase' | 'select' };
  /** Tiles that block the current action. */
  blocked?: [number, number][];
}

const key = (x: number, y: number) => `${x},${y}`;

/** Every farmhouse variant carries the mailbox, just right of its footprint on the bottom row. */
const HOUSE_IDS = new Set(variantsOf('house').map((item) => item.id));
const MAILBOX = GAME_SPRITES['mailbox'];
/** Every greenhouse variant carries the stone path in front of its door (see BakedFeatures.greenhouseDoorstep). */
const GREENHOUSE_IDS = new Set(variantsOf('greenhouse').map((item) => item.id));

/** Copies a block of tiles out of an image into its own texture. */
function cutTexture(image: CanvasImageSource, at: TilePoint, width: number, height: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width * TILE;
  canvas.height = height * TILE;
  canvas.getContext('2d')!.drawImage(image, at.x * TILE, at.y * TILE, width * TILE, height * TILE, 0, 0, width * TILE, height * TILE);
  return Texture.from(canvas);
}

/** Resolves an app-relative asset path against the document base, so loaders and caches agree on one key. */
function absoluteUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/**
 * Draws a plan with PixiJS. Rendering is on demand: nothing is drawn unless
 * something changed, so an idle planner costs no CPU or GPU time.
 */
export class MapRenderer {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly background = new Sprite();
  /** Ground tiled over features painted into the background (see LayoutInfo.baked). */
  private readonly groundPatches = new Container();
  /** The greenhouse's stone path, cut from the background before it is covered up. */
  private greenhouseDoorstep: Texture | null = null;
  private readonly tileLayer = new Container();
  private readonly objectLayer = new Container({ sortableChildren: true });
  private readonly rangeLayer = new Graphics();
  private readonly overlayLayer = new Graphics();
  private readonly previewLayer = new Container();
  private readonly ghostLayer = new Container();
  private readonly previewGraphics = new Graphics();
  private grid: TilingSprite | null = null;
  private readonly tileSprites = new Map<string, Sprite>();
  private readonly objectSprites = new Map<number, Container>();
  private readonly selectedUids = new Set<number>();
  private hoveredUid: number | null = null;
  private alwaysShowRanges: readonly RangeGroup[] = [];
  private layout: LayoutInfo | null = null;
  private doc: PlanDocument | null = null;
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  async init(host: HTMLElement): Promise<void> {
    TextureSource.defaultOptions.scaleMode = 'nearest';
    // Worker-based image decoding stalls in some browsers; sprites are tiny, so decode on the main thread.
    Assets.setPreferences({ preferWorkers: false });
    await this.app.init({
      autoStart: false,
      sharedTicker: false,
      backgroundAlpha: 0,
      antialias: false,
      roundPixels: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      width: host.clientWidth,
      height: host.clientHeight,
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.app.ticker.stop();
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';

    this.world.addChild(this.background, this.groundPatches, this.tileLayer, this.objectLayer, this.rangeLayer, this.overlayLayer, this.previewLayer);
    this.previewLayer.addChild(this.ghostLayer, this.previewGraphics);
    this.app.stage.addChild(this.world);
    this.grid = new TilingSprite({ texture: this.createGridTexture(), alpha: 0.35 });
    this.world.addChildAt(this.grid, 3);

    // Texture.from() only finds preloaded images, so load every sprite up front, including the
    // game sprites drawn as parts of other items (the mailbox).
    await Assets.load([
      ...CATALOG.map((item) => absoluteUrl(spriteUrl(item))),
      ...Object.values(GAME_SPRITES).map((sprite) => absoluteUrl(`assets/game/${sprite.file}`)),
    ]);

    this.resizeObserver = new ResizeObserver(() => {
      this.app.renderer.resize(host.clientWidth, host.clientHeight);
      this.requestRender();
    });
    this.resizeObserver.observe(host);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get zoom(): number {
    return this.world.scale.x;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    if (this.app.renderer) this.app.destroy(true, { children: true });
  }

  requestRender(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.destroyed) this.app.render();
    });
  }

  // --- Plan contents -------------------------------------------------------

  async setLayout(layout: LayoutInfo, doc: PlanDocument): Promise<void> {
    const changed = this.layout?.id !== layout.id;
    this.layout = layout;
    this.doc = doc;
    if (changed) {
      this.background.texture = await Assets.load<Texture>(absoluteUrl(`assets/layouts/${layout.image}`));
      this.background.width = layout.width * TILE;
      this.background.height = layout.height * TILE;
      this.coverBakedFeatures(layout);
      if (this.grid) {
        this.grid.width = layout.width * TILE;
        this.grid.height = layout.height * TILE;
      }
      this.fitToView();
    }
    this.rebuild();
  }

  /** Redraws every tile and object from the document. */
  rebuild(): void {
    if (!this.doc) return;
    for (const sprite of this.tileSprites.values()) sprite.destroy();
    for (const sprite of this.objectSprites.values()) sprite.destroy();
    this.tileSprites.clear();
    this.objectSprites.clear();
    for (const [cell, itemId] of this.doc.allTiles()) {
      const [x, y] = parseKey(cell);
      this.setTile(x, y, itemId);
    }
    for (const obj of this.doc.allObjects()) this.addObject(obj);
    this.drawRanges();
    this.requestRender();
  }

  applyPatch(patch: Patch): void {
    for (const change of patch.tiles) this.setTile(change.x, change.y, change.after);
    for (const change of patch.objects) {
      if (change.before) this.removeObject(change.before.uid);
      if (change.after) this.addObject(change.after);
    }
    this.drawRanges();
    this.requestRender();
  }

  private setTile(x: number, y: number, itemId: string | null): void {
    const cell = key(x, y);
    const existing = this.tileSprites.get(cell);
    const item = itemId ? findItem(itemId) : undefined;
    if (!item) {
      existing?.destroy();
      this.tileSprites.delete(cell);
      return;
    }
    const sprite = existing ?? new Sprite();
    sprite.texture = Texture.from(absoluteUrl(spriteUrl(item)));
    sprite.position.set(x * TILE, y * TILE);
    sprite.setSize(TILE, TILE);
    if (!existing) {
      this.tileLayer.addChild(sprite);
      this.tileSprites.set(cell, sprite);
    }
  }

  private addObject(obj: PlacedObject): void {
    const item = findItem(obj.itemId);
    if (!item) return;
    const view = this.createObjectView(item);
    view.position.set(obj.x * TILE, obj.y * TILE);
    // Objects further down the map draw on top.
    view.zIndex = obj.y + item.height;
    view.tint = this.selectedUids.has(obj.uid) ? 0x9ecbff : 0xffffff;
    this.objectLayer.addChild(view);
    this.objectSprites.set(obj.uid, view);
  }

  /**
   * An object's sprite plus anything attached to it (the farmhouse's mailbox). The view's origin is
   * the footprint's top-left; sprites sit on the footprint's bottom edge, so roofs and lids extend
   * above it.
   */
  private createObjectView(item: CatalogItem): Container {
    const view = new Container();
    const sprite = new Sprite(Texture.from(absoluteUrl(spriteUrl(item))));
    const bottom = item.height * TILE;
    if (item.art) {
      // Game art at its own size, offset exactly as the game draws it.
      sprite.position.set(item.art.offsetX, bottom - item.art.height + item.art.offsetY);
      sprite.setSize(item.art.width, item.art.height);
    } else {
      // v2 sprites: fit the footprint's width, keeping proportions.
      const width = item.width * TILE;
      const height = Math.min((item.spriteHeight ?? item.height) * TILE, Math.round((width * sprite.texture.height) / sprite.texture.width));
      sprite.position.set(0, bottom - height);
      sprite.setSize(width, height);
    }
    view.addChild(sprite);
    if (HOUSE_IDS.has(item.id) && MAILBOX) {
      const mailbox = new Sprite(Texture.from(absoluteUrl(`assets/game/${MAILBOX.file}`)));
      mailbox.position.set(item.width * TILE, bottom - MAILBOX.height);
      view.addChild(mailbox);
    }
    if (GREENHOUSE_IDS.has(item.id) && this.greenhouseDoorstep) {
      // The path fills the game's 3x2 doorstep, two tiles in from the left, below the footprint.
      const path = new Sprite(this.greenhouseDoorstep);
      path.position.set(2 * TILE, bottom);
      view.addChild(path);
    }
    return view;
  }

  /**
   * Hides the farmhouse foundation, mailbox, shipping bin, greenhouse foundation and pet bowl painted
   * into the farm image by tiling clean ground over them; they are drawn as movable objects instead.
   */
  private coverBakedFeatures(layout: LayoutInfo): void {
    for (const child of this.groundPatches.removeChildren()) child.destroy();
    this.greenhouseDoorstep = null;
    const baked = layout.baked;
    const image = this.background.texture.source.resource as CanvasImageSource | undefined;
    if (!baked || !image) return;

    if (baked.greenhouseDoorstep) this.greenhouseDoorstep = cutTexture(image, baked.greenhouseDoorstep, 3, 2);
    const grounds = new Map<string, Texture>();
    for (const area of baked.cover) {
      const sample = area.ground ?? baked.groundSample;
      const sampleKey = key(sample.x, sample.y);
      let ground = grounds.get(sampleKey);
      if (!ground) {
        ground = cutTexture(image, sample, 2, 2);
        grounds.set(sampleKey, ground);
      }
      const patch = new TilingSprite({ texture: ground, width: area.width * TILE, height: area.height * TILE });
      patch.position.set(area.x * TILE, area.y * TILE);
      // Keep the tiling aligned with the map grid so neighbouring patches line up.
      patch.tilePosition.set(-area.x * TILE, -area.y * TILE);
      this.groundPatches.addChild(patch);
    }
  }

  private removeObject(uid: number): void {
    this.objectSprites.get(uid)?.destroy();
    this.objectSprites.delete(uid);
  }

  // --- Overlays ------------------------------------------------------------

  setGridVisible(visible: boolean): void {
    if (this.grid) this.grid.visible = visible;
    this.requestRender();
  }

  setRestrictionOverlay(mode: RestrictionOverlay, map: RestrictionMap): void {
    const g = this.overlayLayer;
    g.clear();
    if (mode !== 'none') {
      const bit = mode === 'buildable' ? NOT_BUILDABLE : NOT_TILLABLE;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if ((map.bits(x, y) & bit) === 0) g.rect(x * TILE, y * TILE, TILE, TILE);
        }
      }
      g.fill({ color: mode === 'buildable' ? 0x38bdf8 : 0xa3e635, alpha: 0.28 });
    }
    this.requestRender();
  }

  setSelection(uids: readonly number[]): void {
    this.selectedUids.clear();
    for (const uid of uids) this.selectedUids.add(uid);
    for (const [uid, view] of this.objectSprites) {
      view.tint = this.selectedUids.has(uid) ? 0x9ecbff : 0xffffff;
    }
    this.drawRanges();
    this.requestRender();
  }

  setHovered(uid: number | null): void {
    if (uid === this.hoveredUid) return;
    this.hoveredUid = uid;
    this.drawRanges();
    this.requestRender();
  }

  setAlwaysShowRanges(groups: readonly RangeGroup[]): void {
    this.alwaysShowRanges = groups;
    this.drawRanges();
    this.requestRender();
  }

  /** Ranges for objects in the "always show" groups, plus the hovered and selected objects. */
  private drawRanges(): void {
    const g = this.rangeLayer;
    g.clear();
    if (!this.doc) return;
    const byColor = new Map<number, Set<string>>();
    const addRange = (obj: { itemId: string; x: number; y: number }) => {
      const range = findItem(obj.itemId)?.range;
      if (!range) return;
      const tiles = byColor.get(range.color) ?? new Set<string>();
      for (const [x, y] of rangeTiles(range, obj.x, obj.y)) tiles.add(key(x, y));
      byColor.set(range.color, tiles);
    };
    for (const obj of this.doc.allObjects()) {
      const range = findItem(obj.itemId)?.range;
      if (!range) continue;
      if (this.alwaysShowRanges.includes(range.group) || obj.uid === this.hoveredUid || this.selectedUids.has(obj.uid)) {
        addRange(obj);
      }
    }
    for (const [color, tiles] of byColor) {
      for (const cell of tiles) {
        const [x, y] = parseKey(cell);
        g.rect(x * TILE, y * TILE, TILE, TILE);
      }
      g.fill({ color, alpha: 0.45 });
    }
  }

  setPreview(preview: Preview | null): void {
    for (const child of this.ghostLayer.removeChildren()) child.destroy();
    const g = this.previewGraphics;
    g.clear();
    for (const ghost of preview?.ghosts ?? []) {
      if (ghost.item.range) {
        for (const [x, y] of rangeTiles(ghost.item.range, ghost.x, ghost.y)) g.rect(x * TILE, y * TILE, TILE, TILE);
        g.fill({ color: ghost.item.range.color, alpha: 0.45 });
      }
      const view = this.createObjectView(ghost.item);
      view.position.set(ghost.x * TILE, ghost.y * TILE);
      view.alpha = 0.7;
      this.ghostLayer.addChild(view);
    }
    if (preview?.rect) {
      const { x, y, width, height, style } = preview.rect;
      const color = style === 'erase' ? 0xef4444 : style === 'select' ? 0x60a5fa : 0xffffff;
      g.rect(x * TILE, y * TILE, width * TILE, height * TILE)
        .fill({ color, alpha: style === 'brush' ? 0.2 : 0.25 })
        .stroke({ color, width: 1 / this.zoom, alpha: 0.9 });
    }
    if (preview?.blocked?.length) {
      for (const [x, y] of preview.blocked) g.rect(x * TILE, y * TILE, TILE, TILE);
      g.fill({ color: 0xff0000, alpha: 0.45 });
    }
    this.requestRender();
  }

  // --- Camera --------------------------------------------------------------

  /** Converts a pointer position to a tile coordinate. */
  toTile(clientX: number, clientY: number): { x: number; y: number } {
    const bounds = this.app.canvas.getBoundingClientRect();
    const local = this.world.toLocal({ x: clientX - bounds.left, y: clientY - bounds.top });
    return { x: Math.floor(local.x / TILE), y: Math.floor(local.y / TILE) };
  }

  panBy(dx: number, dy: number): void {
    this.world.position.set(this.world.x + dx, this.world.y + dy);
    this.requestRender();
  }

  /** Zooms by a factor, keeping the given screen point fixed. */
  zoomAt(factor: number, clientX?: number, clientY?: number): void {
    const bounds = this.app.canvas.getBoundingClientRect();
    const sx = clientX === undefined ? bounds.width / 2 : clientX - bounds.left;
    const sy = clientY === undefined ? bounds.height / 2 : clientY - bounds.top;
    const before = this.world.toLocal({ x: sx, y: sy });
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.world.scale.set(zoom);
    this.world.position.set(sx - before.x * zoom, sy - before.y * zoom);
    this.requestRender();
  }

  fitToView(): void {
    if (!this.layout) return;
    const { width, height } = this.app.screen;
    const mapWidth = this.layout.width * TILE;
    const mapHeight = this.layout.height * TILE;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(width / mapWidth, height / mapHeight)));
    this.world.scale.set(zoom);
    this.world.position.set((width - mapWidth * zoom) / 2, (height - mapHeight * zoom) / 2);
    this.requestRender();
  }

  /** Renders the whole map, without overlays, to a PNG. */
  async exportPng(): Promise<Blob> {
    const hidden = [this.previewLayer, this.overlayLayer, this.grid].filter((c): c is Container => Boolean(c?.visible));
    for (const c of hidden) c.visible = false;
    const { x, y } = this.world.position;
    const scale = this.zoom;
    this.world.position.set(0, 0);
    this.world.scale.set(1);
    try {
      const frame = new Rectangle(0, 0, (this.layout?.width ?? 0) * TILE, (this.layout?.height ?? 0) * TILE);
      const canvas = this.app.renderer.extract.canvas({ target: this.world, frame, resolution: 2 }) as HTMLCanvasElement;
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png'),
      );
    } finally {
      this.world.position.set(x, y);
      this.world.scale.set(scale);
      for (const c of hidden) c.visible = true;
      this.requestRender();
    }
  }

  private createGridTexture(): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, TILE, 1);
    ctx.fillRect(0, 0, 1, TILE);
    return Texture.from(canvas);
  }
}
