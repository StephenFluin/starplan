import { Camera, wheelZoomFactor } from './camera';

function camera(): Camera {
  const cam = new Camera();
  cam.map = { width: 1280, height: 1040 };
  cam.resize({ width: 800, height: 600 });
  cam.fit();
  return cam;
}

/** The map point under a screen point. */
const mapPoint = (cam: Camera, sx: number, sy: number) => ({
  x: (sx - cam.view.x) / cam.view.zoom,
  y: (sy - cam.view.y) / cam.view.zoom,
});

describe('wheelZoomFactor', () => {
  it('zooms 1.2x per mouse wheel notch, in either direction', () => {
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(1.2);
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(1 / 1.2);
  });

  it('caps a single event, so accelerated wheels zoom smoothly', () => {
    expect(wheelZoomFactor({ deltaY: -1000, deltaMode: 0, ctrlKey: false })).toBeCloseTo(
      Math.pow(1.2, 1.5),
    );
  });

  it('treats line-based deltas (Firefox) as pixels', () => {
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(
      Math.pow(1.2, 0.48),
    );
  });

  it('zooms faster for pinches, which arrive as small Ctrl + wheel deltas', () => {
    expect(wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true })).toBeGreaterThan(
      wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: false }),
    );
  });
});

describe('Camera', () => {
  it('fits the whole map, centred', () => {
    const cam = camera();
    expect(cam.view.zoom).toBeCloseTo(600 / 1040);
    expect(cam.view.x).toBeCloseTo((800 - 1280 * cam.view.zoom) / 2);
    expect(cam.view.y).toBeCloseTo(0);
  });

  it('keeps the map point under the pointer in place while zooming', () => {
    const cam = camera();
    const before = mapPoint(cam, 300, 200);
    cam.zoomAt(2, 300, 200, 0);
    cam.step(100);
    expect(mapPoint(cam, 300, 200).x).toBeCloseTo(before.x);
    cam.step(1000);
    expect(cam.moving).toBe(false);
    expect(cam.view.zoom).toBeCloseTo((600 / 1040) * 2);
    expect(mapPoint(cam, 300, 200).x).toBeCloseTo(before.x);
    expect(mapPoint(cam, 300, 200).y).toBeCloseTo(before.y);
  });

  it('eases into a zoom, and adds up zooms that arrive during one', () => {
    const cam = camera();
    const start = cam.view.zoom;
    cam.zoomAt(1.2, 400, 300, 0);
    cam.step(50);
    expect(cam.view.zoom).toBeGreaterThan(start);
    expect(cam.view.zoom).toBeLessThan(start * 1.2);
    cam.zoomAt(1.2, 400, 300, 50);
    cam.step(1000);
    expect(cam.view.zoom).toBeCloseTo(start * 1.44);
  });

  it('zooms at once when animation is off (reduced motion)', () => {
    const cam = camera();
    cam.animate = false;
    cam.zoomAt(2, 400, 300);
    expect(cam.moving).toBe(false);
    expect(cam.view.zoom).toBeCloseTo((600 / 1040) * 2);
  });

  it('limits zoom: never past 8x, and always far enough out to see the whole map', () => {
    const cam = camera();
    cam.animate = false;
    cam.zoomAt(1000);
    expect(cam.view.zoom).toBe(8);
    cam.zoomAt(0.0001);
    expect(cam.view.zoom).toBeCloseTo(Math.min(0.5, 600 / 1040));
  });

  it("can't lose the map off screen", () => {
    const cam = camera();
    cam.panBy(10_000, 10_000);
    expect(cam.view.x).toBe(400);
    expect(cam.view.y).toBe(300);
    cam.panBy(-100_000, -100_000);
    expect(cam.view.x + 1280 * cam.view.zoom).toBeCloseTo(400);
    expect(cam.view.y + 1040 * cam.view.zoom).toBeCloseTo(300);
  });

  it('glides after a flick, slows down and stops', () => {
    const cam = camera();
    cam.animate = false;
    cam.zoomAt(4);
    cam.animate = true;
    const x = cam.view.x;
    cam.fling(-1, 0, 0);
    cam.step(16);
    expect(cam.view.x).toBeLessThan(x);
    for (let t = 32; t < 5000 && cam.moving; t += 16) cam.step(t);
    expect(cam.moving).toBe(false);
  });

  it("doesn't glide after a slow drag, or when animation is off", () => {
    const cam = camera();
    cam.fling(0.01, 0, 0);
    expect(cam.moving).toBe(false);
    cam.animate = false;
    cam.fling(2, 0, 0);
    expect(cam.moving).toBe(false);
  });
});
