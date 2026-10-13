import { WheelGesture, WheelInput } from './wheel-gesture';

const wheel = (overrides: Partial<WheelInput>): WheelInput => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  shiftKey: false,
  timeStamp: 0,
  ...overrides,
});

describe('WheelGesture', () => {
  it('zooms for a mouse wheel notch (Chromium: deltaY 100, wheelDeltaY -120)', () => {
    const action = new WheelGesture().handle(wheel({ deltaY: 100, wheelDeltaY: -120 }));
    expect(action.kind).toBe('zoom');
    expect(action.kind === 'zoom' && action.factor).toBeLessThan(1);
  });

  it('zooms for line-based wheel deltas (Firefox mice), scaled to pixels', () => {
    const action = new WheelGesture().handle(wheel({ deltaY: -3, deltaMode: 1 }));
    expect(action).toEqual({ kind: 'zoom', factor: Math.exp(3 * 16 * 0.0015) });
  });

  it('pans for a two-finger trackpad scroll', () => {
    expect(new WheelGesture().handle(wheel({ deltaX: 2, deltaY: 6 }))).toEqual({ kind: 'pan', dx: -2, dy: -6 });
    expect(new WheelGesture().handle(wheel({ deltaY: 4, wheelDeltaY: -12 }))).toEqual({ kind: 'pan', dx: -0, dy: -4 });
    expect(new WheelGesture().handle(wheel({ deltaY: 1.5 })).kind).toBe('pan');
  });

  it('zooms for a pinch, which browsers send as Ctrl+wheel', () => {
    expect(new WheelGesture().handle(wheel({ deltaY: 2.5, ctrlKey: true })).kind).toBe('zoom');
  });

  it('pans sideways for Shift+wheel on a mouse', () => {
    expect(new WheelGesture().handle(wheel({ deltaY: 100, wheelDeltaY: -120, shiftKey: true }))).toEqual({ kind: 'pan', dx: -100, dy: 0 });
  });

  it('keeps a trackpad gesture panning when one event looks like a wheel notch', () => {
    const gesture = new WheelGesture();
    expect(gesture.handle(wheel({ deltaY: 4, wheelDeltaY: -12, timeStamp: 0 })).kind).toBe('pan');
    expect(gesture.handle(wheel({ deltaY: 40, wheelDeltaY: -120, timeStamp: 16 })).kind).toBe('pan');
  });

  it('remembers the last device for events with no telltale signs', () => {
    const gesture = new WheelGesture();
    gesture.handle(wheel({ deltaY: 4, wheelDeltaY: -12, timeStamp: 0 }));
    expect(gesture.handle(wheel({ deltaY: 10, timeStamp: 1000 })).kind).toBe('pan');
    gesture.handle(wheel({ deltaY: 100, wheelDeltaY: -120, timeStamp: 2000 }));
    expect(gesture.handle(wheel({ deltaY: 10, timeStamp: 3000 })).kind).toBe('zoom');
  });
});
