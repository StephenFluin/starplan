import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture, TextureSource, TilingSprite } from 'pixi.js';
import { CATALOG, CatalogItem, RangeGroup, findItem, spriteUrl, variantsOf } from '../../../core/data/catalog';
import { GAME_SPRITES } from '../../../core/data/game-art.generated';
import { LayoutInfo } from '../../../core/data/layout-info';
import { Patch, PlacedObject, PlanDocument, parseKey } from '../../../core/plan/plan-document';
import { TileRect } from '../../../core/plan/placement';
import { greenhouseDirtShown } from '../../../core/plan/default-buildings';
import { rangeTiles } from '../../../core/plan/range';
import { NOT_BUILDABLE, NOT_TILLABLE, RestrictionMap } from '../../../core/plan/restriction-map';
import { RestrictionOverlay, Selection } from '../../../core/planner-store';
import { Camera } from './camera';

export const TILE = 16;

/** What the cursor is about to do, drawn above everything else. */
export interface Preview {
  /** Ghost sprites for objects being placed or moved. */
  ghosts?: { item: CatalogItem; x: number; y: number }[];
  /** Ghost ground tiles being moved or pasted. */
  tiles?: { item: CatalogItem; x: number; y: number }[];
  /** Drag rectangle for brushes, the eraser or marquee selection. */
  rect?: TileRect & { style: 'brush' | 'erase' | 'select' };
  /** Tiles that block the current action. */
  blocked?: [number, number][];
  /** Tiles a freehand eraser stroke will clear. */
  erased?: [number, number][];
  /** The keyboard cursor's tile, outlined. */
  cursor?: { x: number; y: number };
}

const key = (x: number, y: number) => `${x},${y}`;

/** Every farmhouse variant carries the mailbox, just right of its footprint on the bottom row. */
const HOUSE_IDS = new Set(variantsOf('house').map((item) => item.id));
const MAILBOX = GAME_SPRITES['mailbox'];

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
  /** The sand the greenhouse's first move lays over its start location. */
  private readonly greenhouseDirt = new Sprite();
  /** Art buildings draw on the ground (the greenhouse's shadow and doorstep), under floors. */
  private readonly groundLayer = new Container();
  private readonly tileLayer = new Container();
  private readonly objectLayer = new Container({ sortableChildren: true });
  /** Highlights selected ground tiles, above tiles and below objects. */
  private readonly tileSelectionLayer = new Graphics();
  private readonly rangeLayer = new Graphics();
  private readonly overlayLayer = new Graphics();
  private readonly previewLayer = new Container();
  private readonly ghostLayer = new Container();
  private readonly previewGraphics = new Graphics();
  private grid: TilingSprite | null = null;
  private readonly tileSprites = new Map<string, Sprite>();
  private readonly objectSprites = new Map<number, Container>();
  private readonly groundSprites = new Map<number, Sprite>();
  private readonly selectedUids = new Set<number>();
  private hoveredUid: number | null = null;
  private alwaysShowRanges: readonly RangeGroup[] = [];
  private layout: LayoutInfo | null = null;
  private doc: PlanDocument | null = null;
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly camera = new Camera();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
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

    this.world.addChild(
      this.background,
      this.greenhouseDirt,
      this.groundLayer,
      this.tileLayer,
      this.objectLayer,
      this.rangeLayer,
      this.overlayLayer,
      this.previewLayer,
    );
    this.previewLayer.addChild(this.ghostLayer, this.previewGraphics);
    this.app.stage.addChild(this.world);
    this.grid = new TilingSprite({ texture: this.createGridTexture(), alpha: 0.35 });
    // Above ground tiles, below objects.
    this.world.addChildAt(this.grid, this.world.getChildIndex(this.objectLayer));
    this.world.addChildAt(this.tileSelectionLayer, this.world.getChildIndex(this.objectLayer));

    // Texture.from() only finds preloaded images, so load every sprite up front, including the
    // game sprites drawn as parts of other items (the mailbox) and buildings' ground art.
    await Assets.load([
      ...new Set([
        ...CATALOG.map((item) => absoluteUrl(spriteUrl(item))),
        ...CATALOG.flatMap((item) => (item.building?.background ? [absoluteUrl(`assets/game/${item.building.background.file}`)] : [])),
        ...Object.values(GAME_SPRITES).map((sprite) => absoluteUrl(`assets/game/${sprite.file}`)),
      ]),
    ]);

    this.resizeObserver = new ResizeObserver(() => {
      this.app.renderer.resize(host.clientWidth, host.clientHeight);
      this.camera.resize({ width: host.clientWidth, height: host.clientHeight });
      this.applyView();
    });
    this.camera.resize({ width: host.clientWidth, height: host.clientHeight });
    this.resizeObserver.observe(host);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get zoom(): number {
    return this.camera.view.zoom;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    if (this.app.renderer) this.app.destroy(true, { children: true });
  }

  requestRender(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      if (this.destroyed) return;
      // Zoom animations and glides keep frames coming until they settle.
      if (this.camera.moving) {
        this.camera.step(now);
        this.syncWorld();
        if (this.camera.moving) this.requestRender();
      }
      this.app.render();
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
      const dirt = layout.greenhouseDirt;
      if (dirt) {
        this.greenhouseDirt.texture = await Assets.load<Texture>(absoluteUrl(`assets/layouts/${dirt.image}`));
        this.greenhouseDirt.position.set(dirt.x * TILE, dirt.y * TILE);
      }
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
    for (const sprite of this.groundSprites.values()) sprite.destroy();
    this.tileSprites.clear();
    this.objectSprites.clear();
    this.groundSprites.clear();
    for (const [cell, itemId] of this.doc.allTiles()) {
      const [x, y] = parseKey(cell);
      this.setTile(x, y, itemId);
    }
    for (const obj of this.doc.allObjects()) this.addObject(obj);
    this.updateGreenhouseDirt();
    this.drawRanges();
    this.requestRender();
  }

  applyPatch(patch: Patch): void {
    for (const change of patch.tiles) this.setTile(change.x, change.y, change.after);
    for (const change of patch.objects) {
      if (change.before) this.removeObject(change.before.uid);
      if (change.after) this.addObject(change.after);
    }
    this.updateGreenhouseDirt();
    this.drawRanges();
    this.requestRender();
  }

  private updateGreenhouseDirt(): void {
    this.greenhouseDirt.visible = Boolean(this.layout && this.doc && greenhouseDirtShown(this.doc, this.layout));
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
    const ground = this.createGroundSprite(item);
    if (ground) {
      ground.position.set(obj.x * TILE + ground.x, obj.y * TILE + ground.y);
      this.groundLayer.addChild(ground);
      this.groundSprites.set(obj.uid, ground);
    }
  }

  /** The art a building draws on the ground, positioned relative to its footprint's top-left. */
  private createGroundSprite(item: CatalogItem): Sprite | null {
    const art = item.building?.background;
    if (!art) return null;
    const sprite = new Sprite(Texture.from(absoluteUrl(`assets/game/${art.file}`)));
    sprite.position.set(art.x, art.y);
    sprite.setSize(art.width, art.height);
    return sprite;
  }

  /**
   * An object's sprite plus anything attached to it (the farmhouse's mailbox). The view's origin is
   * the footprint's top-left; sprites sit on the footprint's bottom edge, so roofs and lids extend
   * above it. Ghosts include the art the object draws on the ground, which placed objects draw on
   * the ground layer.
   */
  private createObjectView(item: CatalogItem, withGround = false): Container {
    const view = new Container();
    const ground = withGround && this.createGroundSprite(item);
    if (ground) view.addChild(ground);
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
    return view;
  }

  private removeObject(uid: number): void {
    this.objectSprites.get(uid)?.destroy();
    this.objectSprites.delete(uid);
    this.groundSprites.get(uid)?.destroy();
    this.groundSprites.delete(uid);
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

  setSelection(selection: Selection): void {
    this.selectedUids.clear();
    for (const uid of selection.objects) this.selectedUids.add(uid);
    for (const [uid, view] of this.objectSprites) {
      view.tint = this.selectedUids.has(uid) ? 0x9ecbff : 0xffffff;
    }
    const g = this.tileSelectionLayer;
    g.clear();
    for (const cell of selection.tiles) {
      const [x, y] = parseKey(cell);
      g.rect(x * TILE, y * TILE, TILE, TILE);
    }
    if (selection.tiles.length) g.fill({ color: 0x60a5fa, alpha: 0.4 });
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
    for (const ghost of preview?.tiles ?? []) {
      const sprite = new Sprite(Texture.from(absoluteUrl(spriteUrl(ghost.item))));
      sprite.position.set(ghost.x * TILE, ghost.y * TILE);
      sprite.setSize(TILE, TILE);
      sprite.alpha = 0.7;
      this.ghostLayer.addChild(sprite);
    }
    for (const ghost of preview?.ghosts ?? []) {
      if (ghost.item.range) {
        for (const [x, y] of rangeTiles(ghost.item.range, ghost.x, ghost.y)) g.rect(x * TILE, y * TILE, TILE, TILE);
        g.fill({ color: ghost.item.range.color, alpha: 0.45 });
      }
      const view = this.createObjectView(ghost.item, true);
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
    if (preview?.erased?.length) {
      for (const [x, y] of preview.erased) g.rect(x * TILE, y * TILE, TILE, TILE);
      g.fill({ color: 0xef4444, alpha: 0.25 });
    }
    if (preview?.cursor) {
      const { x, y } = preview.cursor;
      g.rect(x * TILE, y * TILE, TILE, TILE).stroke({ color: 0xfbbf24, width: 2 / this.zoom, alignment: 1 });
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
    this.camera.panBy(dx, dy);
    this.applyView();
  }

  /** The tile in the middle of the view. */
  centreTile(): { x: number; y: number } {
    const { x, y, zoom } = this.camera.view;
    const { width, height } = this.app.renderer.screen;
    return { x: Math.floor((width / 2 - x) / zoom / TILE), y: Math.floor((height / 2 - y) / zoom / TILE) };
  }

  /** Pans so a tile sits in the middle of the view (as near as the map's edges allow). */
  centreOn(tileX: number, tileY: number): void {
    this.camera.stop();
    const { x, y, zoom } = this.camera.view;
    const { width, height } = this.app.renderer.screen;
    this.panBy(width / 2 - (x + (tileX + 0.5) * TILE * zoom), height / 2 - (y + (tileY + 0.5) * TILE * zoom));
  }

  /**
   * Zooms by a factor around a screen point (the middle of the map by default). Animated unless
   * `animate` is false (pinches follow the fingers directly) or the user prefers reduced motion.
   */
  zoomAt(factor: number, clientX?: number, clientY?: number, animate = true): void {
    const bounds = this.app.canvas.getBoundingClientRect();
    this.camera.animate = animate && !this.reducedMotion.matches;
    this.camera.zoomAt(factor, clientX === undefined ? undefined : clientX - bounds.left, clientY === undefined ? undefined : clientY - bounds.top);
    this.applyView();
  }

  /** Lets a pan glide on at a velocity in pixels per millisecond. */
  fling(vx: number, vy: number): void {
    this.camera.animate = !this.reducedMotion.matches;
    this.camera.fling(vx, vy);
    this.requestRender();
  }

  /** Stops a glide or zoom animation, e.g. when the map is grabbed again. */
  stopMotion(): void {
    this.camera.stop();
  }

  fitToView(): void {
    if (!this.layout) return;
    this.camera.map = { width: this.layout.width * TILE, height: this.layout.height * TILE };
    this.camera.fit();
    this.applyView();
  }

  private applyView(): void {
    this.syncWorld();
    this.requestRender();
  }

  private syncWorld(): void {
    const { x, y, zoom } = this.camera.view;
    this.world.position.set(x, y);
    this.world.scale.set(zoom);
  }

  /** Renders the whole map, without overlays, to a PNG. */
  async exportPng(): Promise<Blob> {
    const hidden = [this.previewLayer, this.overlayLayer, this.grid].filter((c): c is Container => Boolean(c?.visible));
    for (const c of hidden) c.visible = false;
    this.camera.stop();
    this.world.position.set(0, 0);
    this.world.scale.set(1);
    try {
      const frame = new Rectangle(0, 0, (this.layout?.width ?? 0) * TILE, (this.layout?.height ?? 0) * TILE);
      const canvas = this.app.renderer.extract.canvas({ target: this.world, frame, resolution: 2 }) as HTMLCanvasElement;
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png'),
      );
    } finally {
      this.syncWorld();
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
