import { test } from "node:test";
import assert from "node:assert/strict";
import { createLatestValueScheduler } from "../apps/lightcraft-web/mobile-performance.mjs";
import { navigateFromGesture } from "../apps/lightcraft-web/mobile-gestures.mjs";

function frames() {
  const queue = new Map();
  let next = 1;
  return {
    queue,
    requestFrame(callback) { const id = next++; queue.set(id, callback); return id; },
    cancelFrame(id) { queue.delete(id); },
    tick() { const jobs = [...queue.values()]; queue.clear(); jobs.forEach(job => job()); }
  };
}

test("100 slider input events produce only the final Rust edit", async () => {
  const raf = frames();
  const writes = [];
  const scheduler = createLatestValueScheduler(value => { writes.push(value); }, raf);
  for (let value = 1; value <= 100; value++) scheduler.push(value);
  assert.equal(raf.queue.size, 1);
  await scheduler.flush(100);
  assert.deepEqual(writes, [100]);
  assert.equal(scheduler.isBusy(), false);
});

test("writes arriving during a busy Rust command replace obsolete edits", async () => {
  const raf = frames();
  let release;
  const writes = [];
  const scheduler = createLatestValueScheduler(async value => {
    writes.push(value);
    if (value === 10) await new Promise(resolve => { release = resolve; });
  }, raf);
  scheduler.push(10);
  raf.tick();
  await Promise.resolve();
  scheduler.push(11);
  scheduler.push(12);
  const final = scheduler.flush(13);
  assert.deepEqual(writes, [10]);
  release();
  await final;
  assert.deepEqual(writes, [10, 13]);
});

test("cancel drops pending value and waits for active command to settle", async () => {
  const raf = frames();
  const writes = [];
  const scheduler = createLatestValueScheduler(value => { writes.push(value); }, raf);
  scheduler.push(1);
  await scheduler.cancel();
  raf.tick();
  assert.deepEqual(writes, []);
  assert.equal(scheduler.isBusy(), false);
});

const viewport = { width: 400, height: 300 };
const fit = {
  imageRect: { x: 0, y: 50, width: 400, height: 200 },
  canvasRect: { x: 0, y: 0, width: 400, height: 300 },
  zoom: "fit",
  source: { width: 1000, height: 500 },
  pixelsPerPoint: 1
};
const pinch = (factor, sx = 200, sy = 150, ex = sx, ey = sy) =>
  ({ factor, start: { x: sx, y: sy }, end: { x: ex, y: ey } });

test("pinch doubles zoom around fingers without rerendering or losing pan center", () => {
  const result = navigateFromGesture(fit, viewport, pinch(2));
  assert.deepEqual(result.zoom, { percent: 80 });
  assert.deepEqual(result.pan, [0.5, 0.5]);
});

test("one-finger drag pans correctly at magnification without changing zoom", () => {
  const enlarged = {
    ...fit,
    imageRect: { x: -200, y: -50, width: 800, height: 400 },
    zoom: { percent: 80 }
  };
  const result = navigateFromGesture(enlarged, viewport, pinch(1, 200, 150, 300, 150));
  assert.equal(result.zoom.percent, 80);
  assert.equal(result.pan[0], 0.375);
});

test("pinch-out never zooms below Fit and invalid geometry is ignored", () => {
  const result = navigateFromGesture(fit, viewport, pinch(0.3));
  assert.equal(result.zoom, "fit");
  assert.deepEqual(result.pan, [0.5, 0.5]);
  assert.equal(navigateFromGesture({ ...fit, canvasRect: null }, viewport, pinch(2)), null);
});
