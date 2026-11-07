import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safePhotoName,
  createPhotoSaveWorkflow,
  shareSavedPhoto,
  downloadSavedPhoto
} from "../apps/lightcraft-web/saved-photos.mjs";
import { readFileSync } from "node:fs";
import { MOBILE_SAVE_MAX_EDGE, mobileSaveExportParams } from "../apps/lightcraft-web/saved-photos-ui.mjs";

const jpeg = new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0, 1, 2, 3)], { type: "image/jpeg" });
const filename = "Sample-LightCraft.jpg";

class FakeFile extends Blob {
  constructor(chunks, name, opts) {
    super(chunks, opts);
    this.name = name;
  }
}

function testRepository({ reject = false } = {}) {
  const entries = [];
  return {
    entries,
    async add(blob, name, sourceName) {
      if (reject) throw Error("Disk quota exceeded");
      const record = { id: "photo-" + entries.length, name, sourceName, size: blob.size, type: blob.type, savedAt: Date.now(), blob };
      entries.push(record);
      return record;
    }
  };
}

test("mobile Save caps export pixels and preserves a full-resolution imported original", () => {
  const original = { id: 52, fileName: "IMG_0976.DNG", width: 8064, height: 6048 };
  const unchanged = { ...original };
  const params = mobileSaveExportParams(original, original.id);
  assert.deepEqual(params, {
    ids: [52],
    path: "IMG_0976-LightCraft.jpg",
    format: "jpeg",
    quality: 90,
    longEdge: MOBILE_SAVE_MAX_EDGE,
    dontEnlarge: true,
    colorSpace: "srgb"
  });
  assert.equal(MOBILE_SAVE_MAX_EDGE, 2048);
  assert.deepEqual(original, unchanged, "the original and its metadata must not change");
  assert.equal(mobileSaveExportParams({ fileName: "small.jpg" }, 2).dontEnlarge, true);
  assert.throws(() => mobileSaveExportParams(original, -1), /valid photo/);
});

test("filename validation permits finished images and strips paths", () => {
  assert.equal(safePhotoName("../photo.jpg"), "photo.jpg");
  assert.equal(safePhotoName("C:\\Users\\photo.jpg"), "photo.jpg");
  assert.equal(safePhotoName("scan.PNG"), "scan.PNG");
  assert.throws(() => safePhotoName("bad.zip"), /JPEG, PNG or WebP/);
  assert.throws(() => safePhotoName("evil.jpg.exe"), /JPEG, PNG or WebP/);
});

test("Save captures the original Rust output blob into the flat finished pool", async () => {
  const repo = testRepository();
  const session = createPhotoSaveWorkflow(repo);
  const operation = session.saveThrough(async () => {
    assert.equal(session.isSaving(), true);
    assert.equal(session.accept(jpeg, filename), true);
  }, "Original.DNG");
  const saved = await operation;
  assert.equal(saved.name, filename);
  assert.equal(saved.sourceName, "Original.DNG");
  assert.equal(saved.blob, jpeg);
  assert.equal(repo.entries.length, 1);
  assert.equal(session.isSaving(), false);
  assert.equal(session.accept(jpeg, filename), false, "normal exports should not be intercepted");
});

test("multiple Rust write callbacks in one Save don't duplicate photographs", async () => {
  const repo = testRepository();
  const session = createPhotoSaveWorkflow(repo);
  await session.saveThrough(() => {
    assert.equal(session.accept(jpeg, filename), true);
    assert.equal(session.accept(jpeg, "Extra-LightCraft.jpg"), true);
  });
  assert.equal(repo.entries.length, 1);
});

test("failed storage write must never claim the photo was saved", async () => {
  const session = createPhotoSaveWorkflow(testRepository({ reject: true }));
  await assert.rejects(session.saveThrough(() => {
    session.accept(jpeg, filename);
  }), /Disk quota exceeded/);
  assert.equal(session.isSaving(), false);
});

test("a Rust export that returns without writing a photo times out instead of reporting success", async () => {
  const session = createPhotoSaveWorkflow(testRepository(), { timeoutMs: 20 });
  await assert.rejects(session.saveThrough(async () => {}), /did not finish/);
  assert.equal(session.isSaving(), false);
});

test("only an actual user-initiated share call hands a full JPEG to iOS", async () => {
  const calls = [];
  const nav = {
    canShare({ files }) {
      calls.push("canShare");
      return files.length === 1;
    },
    share(payload) {
      calls.push("share");
      assert.equal(payload.files[0].name, filename);
      return Promise.resolve();
    }
  };
  const pending = shareSavedPhoto({ name: filename, blob: jpeg, type: jpeg.type, savedAt: 1 }, nav, FakeFile);
  assert.deepEqual(calls, ["canShare", "share"], "iOS share must occur synchronously in a tap handler");
  await pending;
});

test("unsupported native image sharing gives an explicit download fallback", () => {
  const data = { name: filename, blob: jpeg, type: jpeg.type, savedAt: 1 };
  assert.throws(() => shareSavedPhoto(data, {}, FakeFile), /Download JPEG/);
  assert.throws(() => shareSavedPhoto(data, { canShare: () => false, share() {} }, FakeFile), /Download JPEG/);
});

test("Download image exports the original saved JPEG bytes with its real filename", () => {
  const clicks = [];
  const urls = {
    createObjectURL(blob) {
      assert.equal(blob, jpeg);
      return "blob:lightcraft/photo";
    },
    revokeObjectURL() {}
  };
  const documentObject = {
    createElement(tag) {
      assert.equal(tag, "a");
      return { click() { clicks.push([this.href, this.download]); } };
    }
  };
  downloadSavedPhoto({ name: filename, blob: jpeg }, documentObject, urls);
  assert.deepEqual(clicks, [["blob:lightcraft/photo", filename]]);
});

test("mobile shell references the real Rust export hook and does not create fake edits", () => {
  const ui = readFileSync(new URL("../apps/lightcraft-web/saved-photos-ui.mjs", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../apps/lightcraft-web/src/web.rs", import.meta.url), "utf8");
  const html = readFileSync(new URL("../apps/lightcraft-web/index.html", import.meta.url), "utf8");
  const build = readFileSync(new URL("../xtask/src/web.rs", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../apps/lightcraft-web/sw.js", import.meta.url), "utf8");
  assert.match(rust, /lightcraftReceivePhotoExport/);
  assert.match(rust, /handled\.as_bool\(\) == Some\(true\)/);
  assert.match(ui, /workflow\.saveThrough/);
  assert.match(ui, /call\("app\.export"/);
  assert.match(ui, /format: "jpeg"/);
  assert.match(ui, /longEdge: MOBILE_SAVE_MAX_EDGE/);
  assert.match(ui, /dontEnlarge: true/);
  assert.match(ui, /preview\.removeAttribute\("src"\)/);
  assert.match(ui, /shareSavedPhoto\(selected, navigator, File\)/);
  assert.match(html, /id="save_result_dialog"/);
  assert.match(html, /id="saved_pool_items"/);
  assert.match(html, /id="share_saved_photo"/);
  assert.match(html, /Save Image/);
  assert.match(build, /"saved-photos\.mjs"/);
  assert.match(build, /"saved-photos-ui\.mjs"/);
  assert.ok(sw.includes('"./saved-photos.mjs"'));
  assert.doesNotMatch(ui, /getImageData|putImageData|canvas\.toDataURL/);
});
