/** Where the map is drawn: screen position of its top-left corner, and its scale. */
export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

const MAX_ZOOM = 8;
/** The farthest out you can zoom, unless the whole map needs more room than that to fit. */
const MIN_ZOOM = 0.5;
const ZOOM_MS = 200;
/** Velocity kept per millisecond while gliding after a flick. */
const GLIDE_FRICTION = 0.995;
const GLIDE_STOP = 0.02;
/** Zoom per wheel notch (100px of scrolling), and per 100px of pinching. */
const WHEEL_STEP = 1.2;
const PINCH_STEP = 4;
const LINE_PX = 16;
const PAGE_PX = 800;
/** Caps one wheel event, so accelerated or free-spinning wheels can't jump several steps at once. */
const MAX_WHEEL_PX = 150;

/**
 * The zoom factor for a wheel event, like Google Maps: scrolling zooms in or out around the
 * pointer, in proportion to how far you scroll. Trackpad pinches arrive as Ctrl+wheel with small
 * deltas, so they zoom faster per pixel.
 */
export function wheelZoomFactor(
  event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>,
): number {
  const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1;
  const delta = Math.max(-MAX_WHEEL_PX, Math.min(MAX_WHEEL_PX, event.deltaY * scale));
  return Math.pow(event.ctrlKey ? PINCH_STEP : WHEEL_STEP, -delta / 100);
}

interface ZoomAnimation {
  from: number;
  to: number;
  start: number;
  /** The screen point that stays put, and the map point under it. */
  anchor: { sx: number; sy: number; mx: number; my: number };
}

/**
 * Pans and zooms a map of `map` pixels (at zoom 1) inside a `viewport`. Zooming eases toward its
 * target, and a flicked pan glides to a stop; call {@link step} every frame while
 * {@link moving} is true. The map always covers the middle of the viewport, so it can't be lost.
 */
export class Camera {
  view: View = { x: 0, y: 0, zoom: 1 };
  viewport: Size = { width: 0, height: 0 };
  map: Size = { width: 0, height: 0 };
  /** False when the user prefers reduced motion: zooms are instant and pans don't glide. */
  animate = true;

  private zoomAnimation: ZoomAnimation | null = null;
  private glide: { vx: number; vy: number; last: number } | null = null;

  get moving(): boolean {
    return this.zoomAnimation !== null || this.glide !== null;
  }

  get minZoom(): number {
    return Math.min(MIN_ZOOM, this.fitZoom());
  }

  /** Shows the whole map, centred. */
  fit(): void {
    this.stop();
    const zoom = this.fitZoom();
    this.view = {
      zoom,
      x: (this.viewport.width - this.map.width * zoom) / 2,
      y: (this.viewport.height - this.map.height * zoom) / 2,
    };
  }

  panBy(dx: number, dy: number): void {
    this.glide = null;
    this.view = this.clamp({ ...this.view, x: this.view.x + dx, y: this.view.y + dy });
    // Keep an ongoing zoom anchored to the same map point under the moved pointer.
    if (this.zoomAnimation) {
      this.zoomAnimation.anchor.sx += dx;
      this.zoomAnimation.anchor.sy += dy;
    }
  }

  /**
   * Zooms by a factor around a screen point (the viewport's centre by default). Successive calls
   * during an animation add up, so a fast scroll zooms smoothly rather than in jumps.
   */
  zoomAt(
    factor: number,
    sx = this.viewport.width / 2,
    sy = this.viewport.height / 2,
    now = performance.now(),
  ): void {
    this.glide = null;
    const current = this.view.zoom;
    const target = this.clampZoom((this.zoomAnimation?.to ?? current) * factor);
    const anchor = { sx, sy, mx: (sx - this.view.x) / current, my: (sy - this.view.y) / current };
    if (!this.animate) {
      this.zoomAnimation = null;
      this.applyZoom(target, anchor);
      return;
    }
    this.zoomAnimation = { from: current, to: target, start: now, anchor };
  }

  /** Lets a pan carry on at a velocity (pixels per millisecond) and slow to a stop. */
  fling(vx: number, vy: number, now = performance.now()): void {
    if (!this.animate || Math.hypot(vx, vy) < GLIDE_STOP * 5) return;
    this.glide = { vx, vy, last: now };
  }

  /** Stops any zoom animation or glide where it is. */
  stop(): void {
    this.zoomAnimation = null;
    this.glide = null;
  }

  /** Advances animations to `now`. */
  step(now: number): void {
    const zoom = this.zoomAnimation;
    if (zoom) {
      const t = Math.min(1, (now - zoom.start) / ZOOM_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      // Interpolate in log space so zooming in and out feel the same.
      this.applyZoom(zoom.from * Math.pow(zoom.to / zoom.from, eased), zoom.anchor);
      if (t >= 1) this.zoomAnimation = null;
    }
    const glide = this.glide;
    if (glide) {
      const dt = Math.min(64, now - glide.last);
      glide.last = now;
      const before = this.view;
      this.view = this.clamp({
        ...before,
        x: before.x + glide.vx * dt,
        y: before.y + glide.vy * dt,
      });
      const decay = Math.pow(GLIDE_FRICTION, dt);
      glide.vx *= decay;
      glide.vy *= decay;
      const stuck = this.view.x === before.x && this.view.y === before.y && dt > 0;
      if (Math.hypot(glide.vx, glide.vy) < GLIDE_STOP || stuck) this.glide = null;
    }
  }

  /** Keeps the view in bounds after the viewport or map changes size. */
  resize(viewport: Size): void {
    this.viewport = viewport;
    this.view = this.clamp({ ...this.view, zoom: this.clampZoom(this.view.zoom) });
  }

  private applyZoom(zoom: number, anchor: ZoomAnimation['anchor']): void {
    this.view = this.clamp({
      zoom,
      x: anchor.sx - anchor.mx * zoom,
      y: anchor.sy - anchor.my * zoom,
    });
  }

  private fitZoom(): number {
    if (!this.map.width || !this.map.height) return 1;
    return Math.min(
      MAX_ZOOM,
      this.viewport.width / this.map.width,
      this.viewport.height / this.map.height,
    );
  }

  private clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(this.minZoom, zoom));
  }

  /** The map must cover the viewport's centre: you can pan to any edge, but not lose the map. */
  private clamp(view: View): View {
    const cx = this.viewport.width / 2;
    const cy = this.viewport.height / 2;
    return {
      zoom: view.zoom,
      x: Math.min(cx, Math.max(cx - this.map.width * view.zoom, view.x)),
      y: Math.min(cy, Math.max(cy - this.map.height * view.zoom, view.y)),
    };
  }
}
