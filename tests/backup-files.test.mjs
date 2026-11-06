import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackupHandoff } from "../apps/lightcraft-web/backup-files.mjs";

class FakeFile extends Blob {
  constructor(parts, name, options) {
    super(parts, options);
    this.name = name;
  }
}

const sampleName = "lightcraft-library-backup-2026-11-06.zip";
const sampleZip = new Blob([Uint8Array.of(80, 75, 3, 4, 0, 0, 1, 2)], { type: "application/zip" });

function harness({ supportsShare = true } = {}) {
  const events = [];
  const clicks = [];
  let shared = null;
  const nav = {
    canShare(data) {
      events.push("canShare");
      return supportsShare && data.files.length === 1 && data.files[0].name === sampleName;
    },
    share(data) {
      events.push("share");
      shared = data;
      return Promise.resolve();
    }
  };
  const documentObject = {
    createElement(name) {
      assert.equal(name, "a");
      const element = { href: "", download: "", rel: "", click() { clicks.push({ ...element }); } };
      return element;
    }
  };
  const urlObject = {
    createObjectURL(blob) {
      assert.equal(blob, sampleZip);
      return "blob:lightcraft-test";
    },
    revokeObjectURL() {}
  };
  const state = { ready: [], notices: [] };
  const handoff = createBackupHandoff({
    navigatorObject: nav,
    documentObject,
    urlObject,
    FileConstructor: FakeFile,
    onReady: meta => state.ready.push(meta),
    onNotice: message => state.notices.push(message)
  });
  return { handoff, state, events, clicks, shared: () => shared };
}

test("a complete library ZIP is staged but never mislabeled as saved", () => {
  const { handoff, state, events, clicks } = harness();
  handoff.stage(sampleZip, sampleName);
  assert.equal(handoff.isPrepared(), true);
  assert.equal(handoff.getPreparedName(), sampleName);
  assert.deepEqual(state.ready, [{ filename: sampleName, size: sampleZip.size }]);
  assert.match(state.notices[0], /NOT saved/);
  assert.equal(events.length, 0);
  assert.equal(clicks.length, 0);
});

test("file share is initiated directly, with the original ZIP bytes", async () => {
  const { handoff, state, events, shared } = harness();
  handoff.stage(sampleZip, sampleName);
  const pending = handoff.sharePrepared();
  assert.deepEqual(events, ["canShare", "share"], "share must happen before a Promise yields");
  await pending;
  assert.equal(shared().files[0].name, sampleName);
  assert.equal(shared().files[0].type, "application/zip");
  assert.deepEqual(new Uint8Array(await shared().files[0].arrayBuffer()), new Uint8Array(await sampleZip.arrayBuffer()));
  assert.match(state.notices.at(-1), /Confirm the ZIP exists/);
});

test("unsupported file shares do not silently copy into browser storage", async () => {
  const { handoff, events, clicks } = harness({ supportsShare: false });
  handoff.stage(sampleZip, sampleName);
  await assert.rejects(handoff.sharePrepared(), /too large or unsupported/);
  assert.deepEqual(events, ["canShare"]);
  assert.equal(clicks.length, 0);
});

test("download fallback exports the exact ready ZIP name through a user-triggered anchor", () => {
  const { handoff, clicks, state } = harness();
  handoff.stage(sampleZip, sampleName);
  handoff.downloadPrepared();
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].href, "blob:lightcraft-test");
  assert.equal(clicks[0].download, sampleName);
  assert.match(state.notices.at(-1), /Verify the ZIP in Files/);
});

test("no share or download is possible before preparing a valid complete ZIP", async () => {
  const { handoff } = harness();
  await assert.rejects(handoff.sharePrepared(), /Prepare a library backup/);
  assert.throws(() => handoff.downloadPrepared(), /Prepare a library backup/);
  assert.throws(() => handoff.stage(new Blob([]), sampleName), /Invalid/);
  assert.throws(() => handoff.stage(sampleZip, "../../unsafe.zip"), /Invalid/);
  assert.throws(() => handoff.stage(sampleZip, "original.jpg"), /Invalid/);
});

test("a subsequent preparation replaces the previous unsaved snapshot", async () => {
  const { handoff, state } = harness();
  handoff.stage(sampleZip, sampleName);
  handoff.stage(new Blob([Uint8Array.of(80, 75, 5, 6)]), "lightcraft-library-backup-2026-11-07.zip");
  assert.equal(handoff.getPreparedName(), "lightcraft-library-backup-2026-11-07.zip");
  assert.equal(state.ready.length, 2);
});
