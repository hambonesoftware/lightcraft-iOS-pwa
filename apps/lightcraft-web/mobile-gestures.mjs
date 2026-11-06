/**
 * iPhone/iPad photo navigation. Touch events control only the photograph
 * canvas, never the editing controls. While a gesture is live, a compositor
 * transform moves the already-rendered GPU canvas. On release ONE view.navigate
 * command commits zoom/pan; the original Rust renderer then refines detail.
 */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function normalWidth(source, imageRect) {
  const aspect = imageRect.width / Math.max(1, imageRect.height);
  const w = Math.max(1, Number(source?.width) || 1);
  const h = Math.max(1, Number(source?.height) || 1);
  return Math.abs(aspect - h / w) < Math.abs(aspect - w / h) ? h : w;
}

export function navigateFromGesture(snapshot, viewport, gesture) {
  const image = snapshot?.imageRect;
  const canvas = snapshot?.canvasRect;
  if (!image || !canvas || !snapshot?.source ||
      canvas.width < 1 || image.width < 1 || viewport.width < 1 || viewport.height < 1) {
    return null;
  }
  const sx = viewport.width / canvas.width;
  const sy = viewport.height / canvas.height;
  const width = image.width * sx;
  const height = image.height * sy;
  const left = (image.x - canvas.x) * sx;
  const top = (image.y - canvas.y) * sy;
  const nativeW = normalWidth(snapshot.source, image);
  const ppp = Math.max(0.1, Number(snapshot.pixelsPerPoint) || 1);
  const aspect = width / Math.max(1, height);
  const fitWidth = Math.min(viewport.width, viewport.height * aspect);
  const fitPercent = fitWidth / nativeW * ppp * 100;
  const activePercent = typeof snapshot.zoom === "object" && Number.isFinite(snapshot.zoom?.percent)
    ? snapshot.zoom.percent
    : (width / nativeW * ppp * 100);
  const factor = clamp(gesture.factor, fitPercent / Math.max(0.001, activePercent), 800 / Math.max(0.001, activePercent));
  const scaledWidth = width * factor;
  const scaledHeight = height * factor;
  const newLeft = gesture.end.x + (left - gesture.start.x) * factor;
  const newTop = gesture.end.y + (top - gesture.start.y) * factor;
  const panX = scaledWidth <= viewport.width + 0.5 ? 0.5 : clamp((viewport.width / 2 - newLeft) / scaledWidth, 0, 1);
  const panY = scaledHeight <= viewport.height + 0.5 ? 0.5 : clamp((viewport.height / 2 - newTop) / scaledHeight, 0, 1);
  const percent = activePercent * factor;
  return {
    zoom: percent <= fitPercent * 1.005 ? "fit" : { percent: Number(percent.toFixed(3)) },
    pan: [Number(panX.toFixed(6)), Number(panY.toFixed(6))],
    factor
  };
}

export function mountPhotoGestures({
  canvas,
  viewport,
  call,
  activePhoto,
  onError = error => console.warn("LightCraft gesture", error),
  requestFrame = cb => requestAnimationFrame(cb),
  cancelFrame = id => cancelAnimationFrame(id)
}) {
  if (!canvas || !viewport || typeof call !== "function") throw Error("Mobile gesture host is incomplete");
  let snapshot = null;
  let snapshotPromise = null;
  let gesture = null;
  let frame = null;
  let busy = false;
  let ignoreRemaining = false;
  let lastTap = null;

  const bounds = () => viewport.getBoundingClientRect();
  const touchPoint = (touch, rect) => ({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
  function points(event, rect) {
    return Array.from(event.touches).map(touch => touchPoint(touch, rect));
  }
  async function refresh() {
    if (snapshotPromise) return snapshotPromise;
    snapshotPromise = call("web.viewport").then(data => {
      snapshot = data?.imageRect && data?.canvasRect && data?.source ? data : null;
      return snapshot;
    }).finally(() => { snapshotPromise = null; });
    return snapshotPromise;
  }
  function clearFrame() {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  }
  function resetTransform() {
    clearFrame();
    canvas.style.transform = "";
    canvas.style.transformOrigin = "";
    canvas.style.willChange = "";
  }
  function suppress(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function begin(event) {
    if (!activePhoto()) return;
    suppress(event);
    if (busy || ignoreRemaining) return;
    const rect = bounds();
    const p = points(event, rect);
    if (!p.length) return;
    if (p.length === 1 && gesture?.kind === "single") return;
    // A second finger rebases the gesture at the new midpoint, avoiding the
    // full image re-render normally requested on every new pinch delta.
    resetTransform();
    const anchor = p.length > 1 ? midpoint(p[0], p[1]) : p[0];
    gesture = {
      kind: p.length > 1 ? "pinch" : "single",
      start: anchor, end: anchor, factor: 1,
      distance: p.length > 1 ? Math.max(1, distance(p[0], p[1])) : 1,
      moved: false,
      viewport: { width: rect.width, height: rect.height },
      initial: snapshot
    };
    // Do not block the first touch frame on a Rust command.
    if (!snapshotPromise) refresh().catch(onError);
  }
  function paint() {
    frame = null;
    if (!gesture) return;
    const g = gesture;
    const state = g.initial || snapshot;
    const intended = navigateFromGesture(state, g.viewport, g);
    if (!intended) return;
    const factor = intended.factor;
    if (g.kind === "single" && intended.zoom === "fit") return;
    // Transform around the initial finger midpoint so the same image pixel
    // stays under the fingers; browser compositor does this without decoding
    // RAW or running the Rust color pipeline.
    canvas.style.willChange = "transform";
    canvas.style.transformOrigin = g.start.x + "px " + g.start.y + "px";
    canvas.style.transform = "translate3d(" + (g.end.x - g.start.x).toFixed(2) +
      "px, " + (g.end.y - g.start.y).toFixed(2) + "px, 0) scale(" + factor.toFixed(5) + ")";
  }
  function move(event) {
    if (!activePhoto()) return;
    suppress(event);
    if (!gesture || busy || ignoreRemaining) return;
    const p = points(event, bounds());
    if (!p.length || (gesture.kind === "pinch" && p.length < 2)) return;
    const end = gesture.kind === "pinch" ? midpoint(p[0], p[1]) : p[0];
    const factor = gesture.kind === "pinch" ? distance(p[0], p[1]) / gesture.distance : 1;
    gesture.end = end;
    gesture.factor = clamp(factor, 0.1, 20);
    gesture.moved ||= distance(gesture.start, end) > 5 || Math.abs(factor - 1) > .015;
    if (frame === null) frame = requestFrame(paint);
  }
  async function finish(event) {
    if (!activePhoto()) return;
    suppress(event);
    if (!gesture || busy) {
      if (event.touches.length === 0) ignoreRemaining = false;
      return;
    }
    if (event.touches.length > 0 && gesture.kind === "single") return;
    ignoreRemaining = event.touches.length > 0;
    const g = gesture;
    gesture = null;
    clearFrame();
    const now = Date.now();
    const isTap = g.kind === "single" && !g.moved;
    const sameArea = lastTap && distance(lastTap.point, g.end) < 35;
    const doubleTap = isTap && lastTap && now - lastTap.time < 320 && sameArea;
    lastTap = isTap && !doubleTap ? { time: now, point: g.end } : null;
    if (!g.moved && !doubleTap) {
      resetTransform();
      return;
    }
    busy = true;
    try {
      if (doubleTap) {
        resetTransform();
        await call("view.zoomToggle");
        await new Promise(resolve => requestFrame(resolve));
      } else {
        const state = g.initial || snapshot || await refresh();
        const intent = navigateFromGesture(state, g.viewport, g);
        if (intent) {
          await call("view.navigate", { zoom: intent.zoom, pan: intent.pan });
          // Keep the old composited view under the fingers until egui has
          // painted the new Rust viewport. Dropping the CSS transform as
          // soon as the command resolves would visibly snap to the old view.
          await new Promise(resolve => requestFrame(resolve));
          await new Promise(resolve => requestFrame(resolve));
        }
      }
    } catch (error) {
      onError(error);
    } finally {
      resetTransform();
      busy = false;
      snapshot = null;
      refresh().catch(onError);
    }
  }
  function cancel(event) {
    suppress(event);
    gesture = null;
    resetTransform();
    ignoreRemaining = event.touches.length > 0;
  }
  // Eframe also listens for browser PointerEvents. An iPhone fires both
  // pointer and touch events; without suppressing pointer dispatch the legacy
  // egui loupe can pan or zoom a second time behind our compositor transform.
  // Preserve mouse and stylus input unchanged.
  function preventDuplicatePointer(event) {
    if (!activePhoto() || event.pointerType !== "touch") return;
    event.stopImmediatePropagation();
    if (event.cancelable) event.preventDefault();
  }
  const options = { passive: false, capture: true };
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    canvas.addEventListener(type, preventDuplicatePointer, options);
  }
  canvas.addEventListener("touchstart", begin, options);
  canvas.addEventListener("touchmove", move, options);
  canvas.addEventListener("touchend", finish, options);
  canvas.addEventListener("touchcancel", cancel, options);
  window.addEventListener("resize", () => {
    gesture = null;
    resetTransform();
    snapshot = null;
  });
  return Object.freeze({
    refresh,
    get active() { return Boolean(gesture); },
    reset() { gesture = null; resetTransform(); snapshot = null; }
  });
}
