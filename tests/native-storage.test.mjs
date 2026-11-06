import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeStorage, nativeKey } from "../native/ios-app/src/storage-adapter.mjs";

const missing = () => Object.assign(new Error("File not found"), { code: "OS-PLUG-FILE-0008" });
const forbidden = () => Object.assign(new Error("Permission denied"), { code: "OS-PLUG-FILE-0013" });

function fakeFilesystem() {
  const files = new Map();
  const calls = [];
  const key = p => p.path;
  return {
    files, calls,
    async writeFile(p) {
      calls.push(["writeFile", key(p), p.directory]);
      files.set(key(p), Uint8Array.from(atob(p.data), ch => ch.charCodeAt(0)));
    },
    async readFile(p) {
      calls.push(["readFile", key(p), p.directory]);
      const bytes = files.get(key(p));
      if (!bytes) throw missing();
      return { data: btoa(String.fromCharCode(...bytes)) };
    },
    async stat(p) {
      calls.push(["stat", key(p), p.directory]);
      const bytes = files.get(key(p));
      if (!bytes) throw missing();
      return { size: bytes.length };
    },
    async appendFile(p) {
      calls.push(["appendFile", key(p), p.directory]);
      const old = files.get(key(p)) || new Uint8Array();
      const extra = Uint8Array.from(atob(p.data), ch => ch.charCodeAt(0));
      const next = new Uint8Array(old.length + extra.length);
      next.set(old);
      next.set(extra, old.length);
      files.set(key(p), next);
    },
    async deleteFile(p) {
      calls.push(["deleteFile", key(p), p.directory]);
      if (!files.has(key(p))) throw missing();
      files.delete(key(p));
    },
    async readdir(p) {
      calls.push(["readdir", key(p), p.directory]);
      const prefix = key(p) + "/";
      const items = new Set();
      for (const k of files.keys()) if (k.startsWith(prefix)) {
        items.add(k.slice(prefix.length).split("/")[0]);
      }
      if (!items.size) throw missing();
      return { files: [...items].map(name => ({ name })) };
    },
    async rmdir(p) {
      calls.push(["rmdir", key(p), p.directory]);
      for (const k of [...files.keys()]) if (k === p.path || k.startsWith(p.path + "/")) files.delete(k);
    }
  };
}

test("every native path is confined to the LightCraft Documents subfolder", () => {
  assert.equal(nativeKey("library/catalog.json"), "LightCraft/library/catalog.json");
  assert.equal(nativeKey(""), "LightCraft");
  for (const input of ["../outside", "/absolute", "library/../../outside", "a//b", "a/./b", "x\\y", "x\u0000y"]) {
    assert.throws(() => nativeKey(input), /Unsafe/);
  }
});

test("the native backend stores original photos and library files without OPFS or IndexedDB", async () => {
  const fs = fakeFilesystem();
  const store = createNativeStorage(fs);
  const original = Uint8Array.from([0, 12, 255, 6, 91]);
  await store.write({ path: "originals/deadbeef", bytes: original });
  await store.write({ path: "library/manifest.json", bytes: new TextEncoder().encode("{}") });
  assert.deepEqual(await store.read({ path: "originals/deadbeef" }), original);
  assert.equal(await store.exists({ path: "originals/deadbeef" }), true);
  assert.deepEqual(await store.list({ dir: "originals" }), ["deadbeef"]);
  assert.equal(fs.calls.every(call => call[2] === "DOCUMENTS"), true);
  assert.equal(store.kind, "native-ios-documents");
  assert.equal(await store.read({ path: "originals/absent" }), null);
  assert.equal(await store.exists({ path: "originals/absent" }), false);
});

test("append uses native append at EOF; truncate rewrites exactly the desired prefix", async () => {
  const fs = fakeFilesystem();
  const store = createNativeStorage(fs);
  await store.write({ path: "library/journal", bytes: Uint8Array.from([1, 2, 3, 4]) });
  await store.writeAt({ path: "library/journal", offset: 4, bytes: Uint8Array.from([5, 6]) });
  assert.ok(fs.calls.some(call => call[0] === "appendFile"));
  assert.deepEqual(await store.read({ path: "library/journal" }), Uint8Array.from([1, 2, 3, 4, 5, 6]));
  await store.writeAt({ path: "library/journal", offset: 2, bytes: Uint8Array.from([77]) });
  assert.deepEqual(await store.read({ path: "library/journal" }), Uint8Array.from([1, 2, 77]));
});

test("concurrent writes to one journal serialize rather than losing an append", async () => {
  const store = createNativeStorage(fakeFilesystem());
  await store.write({ path: "library/journal", bytes: Uint8Array.from([1]) });
  await Promise.all([
    store.writeAt({ path: "library/journal", offset: 1, bytes: Uint8Array.from([2]) }),
    store.writeAt({ path: "library/journal", offset: 2, bytes: Uint8Array.from([3]) })
  ]);
  assert.deepEqual(await store.read({ path: "library/journal" }), Uint8Array.from([1, 2, 3]));
});

test("missing files are absent; permission errors never masquerade as empty libraries", async () => {
  const fs = fakeFilesystem();
  fs.readFile = async () => { throw forbidden(); };
  fs.stat = async () => { throw forbidden(); };
  const store = createNativeStorage(fs);
  await assert.rejects(store.read({ path: "library/journal" }), /Permission/);
  await assert.rejects(store.exists({ path: "library/journal" }), /Permission/);
});

test("clear is confined to the app-owned directory", async () => {
  const fs = fakeFilesystem();
  const store = createNativeStorage(fs);
  await store.write({ path: "originals/a", bytes: Uint8Array.of(2) });
  await store.clear();
  assert.equal(fs.files.size, 0);
  assert.ok(fs.calls.some(call => call[0] === "rmdir" && call[1] === "LightCraft"));
  await store.remove({ path: "missing" });
  assert.equal(await store.exists({ path: "missing" }), false);
});
