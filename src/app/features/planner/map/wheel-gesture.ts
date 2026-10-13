/** The parts of a WheelEvent the map reads. `wheelDeltaY` is a legacy, non-standard field. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  timeStamp: number;
  wheelDeltaY?: number;
}

export type WheelAction = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

type Device = 'mouse' | 'trackpad';

/** Wheel events closer together than this belong to one gesture. */
const GESTURE_GAP_MS = 200;
const LINE_PX = 16;
const PAGE_PX = 800;
/** Zoom per pixel of scrolling: gentle for wheel notches, faster for pinches (which send small deltas). */
const WHEEL_ZOOM = 0.0015;
const PINCH_ZOOM = 0.01;

/**
 * Turns wheel events into map gestures. Browsers don't say whether they come from a mouse or a
 * trackpad, so this guesses: a mouse wheel zooms (Shift+wheel pans sideways), a trackpad's
 * two-finger scroll pans, and a pinch (sent as Ctrl+wheel) zooms.
 *
 * Signals, strongest first: Ctrl means pinch or Ctrl+wheel; line or page deltas only come from
 * mouse wheels; sideways or fractional deltas only from trackpads; and Chromium and Safari report
 * mouse notches as multiples of 120 in `wheelDeltaY`. A gesture keeps its first guess, so a scroll
 * can't flip between panning and zooming halfway, unless a sure trackpad signal turns up.
 */
export class WheelGesture {
  private device: Device = 'mouse';
  private lastTime = -Infinity;
  private gestureDevice: Device | null = null;

  handle(event: WheelInput): WheelAction {
    const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1;
    const dx = event.deltaX * scale;
    const dy = event.deltaY * scale;
    const newGesture = event.timeStamp - this.lastTime > GESTURE_GAP_MS;
    this.lastTime = event.timeStamp;

    if (event.ctrlKey) return { kind: 'zoom', factor: Math.exp(-dy * PINCH_ZOOM) };

    const guess = this.guess(event);
    if (newGesture) this.gestureDevice = guess ?? this.device;
    else if (guess === 'trackpad') this.gestureDevice = 'trackpad';
    const device = this.gestureDevice ?? this.device;
    this.device = device;

    if (device === 'trackpad') return { kind: 'pan', dx: -dx, dy: -dy };
    // Browsers turn Shift+wheel into a sideways scroll on some platforms and not others.
    if (event.shiftKey) return { kind: 'pan', dx: -(dx || dy), dy: 0 };
    return { kind: 'zoom', factor: Math.exp(-dy * WHEEL_ZOOM) };
  }

  private guess(event: WheelInput): Device | null {
    if (event.deltaMode !== 0) return 'mouse';
    if (event.deltaX !== 0 && !event.shiftKey) return 'trackpad';
    if (!Number.isInteger(event.deltaX) || !Number.isInteger(event.deltaY)) return 'trackpad';
    const legacy = event.wheelDeltaY;
    if (legacy !== undefined && legacy !== 0) return legacy % 120 === 0 ? 'mouse' : 'trackpad';
    return null;
  }
}
