/**
 * Keep slider interactions responsive: one in-flight Rust command plus only
 * the latest queued value. A slider's DOM readout updates synchronously.
 */
export function createLatestValueScheduler(write, {
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id),
  onError = error => console.error("LightCraft live edit failed", error)
} = {}) {
  let pending;
  let active = null;
  let frame = null;
  let last;
  function clearFrame() {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  }
  function schedule() {
    if (frame !== null || active || pending === undefined) return;
    frame = requestFrame(() => {
      frame = null;
      pump();
    });
  }
  function pump() {
    if (active || pending === undefined) return;
    const value = pending;
    pending = undefined;
    if (Object.is(last, value)) return;
    active = Promise.resolve().then(() => write(value))
      .then(() => { last = value; })
      .finally(() => { active = null; schedule(); });
    active.catch(onError);
  }
  return Object.freeze({
    push(value) {
      if (!Number.isFinite(value)) return;
      pending = value;
      schedule();
    },
    async flush(value) {
      if (value !== undefined) {
        if (!Number.isFinite(value)) throw Error("Invalid adjustment");
        pending = value;
      }
      clearFrame();
      while (pending !== undefined || active) {
        if (!active) pump();
        if (active) await active;
        clearFrame();
      }
    },
    async cancel() {
      pending = undefined;
      clearFrame();
      if (active) await active.catch(() => {});
      pending = undefined;
      clearFrame();
    },
    isBusy() { return pending !== undefined || active !== null; }
  });
}
