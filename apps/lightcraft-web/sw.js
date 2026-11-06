/* LightCraft Local offline application shell.
 * The photo catalog and original files are owned by OPFS/IndexedDB and are
 * intentionally never cached here. This cache only holds immutable app assets.
 * The deployment workflow replaces the build token with its commit SHA.
 */
"use strict";

const PREFIX = "lightcraft-local-shell-";
const CACHE_NAME = PREFIX + "__BUILD_SHA__";
const SHELL_PATHS = [
  "./",
  "./index.html",
  "./mobile-lab.html",
  "./mobile-lab.css",
  "./mobile-lab.mjs",
  "./backup-files.mjs",
  "./worker.js",
  "./lightcraft_web.js",
  "./lightcraft_web_bg.wasm",
  "./manifest.webmanifest",
  "./icon-256.png",
  "./icon-512.png"
];
const SCOPE = self.registration.scope;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Atomic install: do not take over if any essential asset is unavailable.
    await cache.addAll(SHELL_PATHS.map((path) =>
      new Request(new URL(path, SCOPE).href, { cache: "reload" })
    ));
    // No skipWaiting(): older tabs keep the JS/WASM version they loaded.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin ||
      !url.pathname.startsWith(new URL(SCOPE).pathname)) return;

  // Cache first prevents serving mismatched WASM/JavaScript across deployments.
  // Unknown same-origin URLs (including optional fonts) remain network-only.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, {
      ignoreSearch: request.mode === "navigate"
    });
    if (cached) return cached;
    if (request.mode === "navigate") {
      const index = await cache.match(new URL("./index.html", SCOPE).href);
      if (index) return index;
    }
    return fetch(request);
  })());
});
