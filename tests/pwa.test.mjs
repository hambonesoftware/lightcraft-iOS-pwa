import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../apps/lightcraft-web/sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../apps/lightcraft-web/manifest.webmanifest", import.meta.url), "utf8"));
const scope = "https://example.github.io/lightcraft-iOS-pwa/";
const events = new Map();
const removed = [];
const added = [];
const shell = new Map();
const networkRequests = [];
const cache = {
  addAll: async (requests) => {
    added.push(...requests.map((request) => new URL(request.url).pathname));
  },
  match: async (request) => shell.get(typeof request === "string" ? request : request.url),
};
const caches = {
  open: async () => cache,
  keys: async () => ["lightcraft-local-shell-old", "other-application"],
  delete: async (name) => { removed.push(name); return true; },
};
const self = {
  registration: { scope },
  location: { origin: new URL(scope).origin },
  clients: { claim: async () => {} },
  addEventListener: (name, handler) => events.set(name, handler),
};
const context = vm.createContext({
  self, caches, Request, URL, console,
  fetch: async (request) => { networkRequests.push(request.url); return "network"; },
});
vm.runInContext(source, context, { filename: "sw.js" });

test("manifest is an installable, relative-path app", () => {
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.length, 2);
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith("./")));
});

test("installation precaches the editor but never user photo data", async () => {
  let operation;
  events.get("install")({ waitUntil: (promise) => { operation = promise; } });
  await operation;
  assert.equal(added.length, 12);
  assert.ok(added.some((name) => name.endsWith("/mobile-lab.html")));
  assert.ok(added.some((name) => name.endsWith("/mobile-lab.css")));
  assert.ok(added.some((name) => name.endsWith("/mobile-lab.mjs")));
  assert.ok(added.some((name) => name.endsWith("/backup-files.mjs")));
  assert.ok(added.some((name) => name.endsWith("/lightcraft_web_bg.wasm")));
  assert.ok(added.some((name) => name.endsWith("/lightcraft_web.js")));
  assert.ok(!added.some((name) => name.includes("originals/") || name.includes("library/")));
});

test("activation deletes only obsolete LightCraft app shells", async () => {
  let operation;
  events.get("activate")({ waitUntil: (promise) => { operation = promise; } });
  await operation;
  assert.deepEqual(removed, ["lightcraft-local-shell-old"]);
});

test("cached WASM loads while offline and does not contact the network", async () => {
  const wasm = new URL("./lightcraft_web_bg.wasm", scope).href;
  shell.set(wasm, "cached WASM module");
  let promise;
  const request = new Request(wasm);
  events.get("fetch")({ request, respondWith: (value) => { promise = value; } });
  assert.equal(await promise, "cached WASM module");
  assert.equal(networkRequests.length, 0);
});

test("cross-origin requests and non-GET requests bypass the app shell", () => {
  let calls = 0;
  const respondWith = () => { calls += 1; };
  events.get("fetch")({ request: new Request("https://somewhere.test/picture.jpg"), respondWith });
  events.get("fetch")({ request: new Request(new URL("./sync", scope), { method: "POST" }), respondWith });
  assert.equal(calls, 0);
});
