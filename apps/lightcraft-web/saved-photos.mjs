/**
 * Finished LightCraft photographs (not the editing catalog) live in one flat
 * IndexedDB pool. This is still WebKit website data, not Apple Photos.
 *
 * Save is a separate, explicit user action; Apple Photos receives a copy only
 * if the user chooses "Save Image" from the iOS share sheet.
 */
const DATABASE = "lightcraft-finished-photos";
const VERSION = 1;
const ITEMS = "items";
const IMAGES = "images";
const VALID_FILENAME = /^[^/\\\x00-\x1f]{1,180}\.(jpg|jpeg|png|webp)$/i;

function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("Local photo storage request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || Error("Local photo transaction failed"));
    transaction.onabort = () => reject(transaction.error || Error("Local photo transaction was aborted"));
  });
}

export function safePhotoName(name) {
  const base = String(name || "LightCraft-Edited.jpg").split(/[\\/]/).pop()
    .replace(/[\x00-\x1f]/g, "").trim().slice(0, 180);
  if (!VALID_FILENAME.test(base)) throw new Error("LightCraft must export a JPEG, PNG or WebP image.");
  return base;
}

export function createSavedPhotoRepository(idb = globalThis.indexedDB) {
  let pendingDb = null;
  function db() {
    if (!idb) return Promise.reject(Error("IndexedDB is unavailable. This photo was not saved."));
    if (pendingDb) return pendingDb;
    pendingDb = new Promise((resolve, reject) => {
      const request = idb.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ITEMS)) {
          const store = database.createObjectStore(ITEMS, { keyPath: "id" });
          store.createIndex("savedAt", "savedAt");
        }
        if (!database.objectStoreNames.contains(IMAGES)) {
          database.createObjectStore(IMAGES, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || Error("Cannot open saved photo pool"));
      request.onblocked = () => reject(Error("Another LightCraft window is blocking the saved photo pool."));
    }).catch(error => {
      pendingDb = null;
      throw error;
    });
    return pendingDb;
  }

  return Object.freeze({
    async add(blob, filename, sourceName = "") {
      if (!(blob instanceof Blob) || blob.size < 4 || !blob.type.startsWith("image/")) {
        throw new Error("The editor did not produce a valid photo. Nothing was saved.");
      }
      const name = safePhotoName(filename);
      const id = globalThis.crypto?.randomUUID?.() ||
        Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      const item = {
        id,
        name,
        sourceName: String(sourceName).slice(0, 180),
        savedAt: Date.now(),
        size: blob.size,
        type: blob.type
      };
      const database = await db();
      const tx = database.transaction([ITEMS, IMAGES], "readwrite");
      const done = transactionDone(tx);
      tx.objectStore(ITEMS).put(item);
      tx.objectStore(IMAGES).put({ id, blob });
      await done;
      return { ...item, blob };
    },
    async list() {
      const database = await db();
      const items = await requestDone(database.transaction(ITEMS, "readonly").objectStore(ITEMS).getAll());
      return items.sort((a, b) => b.savedAt - a.savedAt || b.id.localeCompare(a.id));
    },
    async get(id) {
      const database = await db();
      const tx = database.transaction([ITEMS, IMAGES], "readonly");
      const info = requestDone(tx.objectStore(ITEMS).get(id));
      const data = requestDone(tx.objectStore(IMAGES).get(id));
      const [item, entry] = await Promise.all([info, data]);
      return item && entry?.blob ? { ...item, blob: entry.blob } : null;
    },
    async remove(id) {
      const database = await db();
      const tx = database.transaction([ITEMS, IMAGES], "readwrite");
      const done = transactionDone(tx);
      tx.objectStore(ITEMS).delete(id);
      tx.objectStore(IMAGES).delete(id);
      await done;
    }
  });
}

export function createPhotoSaveWorkflow(repository, { timeoutMs = 120000 } = {}) {
  let active = null;
  return Object.freeze({
    async saveThrough(exporter, sourceName = "") {
      if (active) throw Error("A photo is already being saved.");
      let resolveResult;
      let rejectResult;
      const captured = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      // Attach a handler immediately: exporter may fail before the callback.
      captured.catch(() => {});
      const job = { resolveResult, rejectResult, sourceName, captured: false };
      active = job;
      const timeout = setTimeout(() => {
        if (active === job) {
          active = null;
          rejectResult(Error("The photo exporter did not finish. No photo was saved."));
        }
      }, timeoutMs);
      try {
        await exporter();
        return await captured;
      } finally {
        clearTimeout(timeout);
        if (active === job) active = null;
      }
    },
    accept(blob, filename) {
      const job = active;
      if (!job) return false; // Other desktop exports keep normal download behavior.
      if (job.captured) return true; // One saved photo per Save press.
      job.captured = true;
      Promise.resolve()
        .then(() => repository.add(blob, filename, job.sourceName))
        .then(item => job.resolveResult(item), error => job.rejectResult(error));
      return true;
    },
    isSaving() {
      return active !== null;
    }
  });
}

export function shareSavedPhoto(item, navigatorObject = navigator, FileType = File) {
  if (!item?.blob) throw Error("Select a saved photo first.");
  if (typeof navigatorObject?.share !== "function" || typeof FileType !== "function") {
    throw Error("This iPhone does not support sharing images. Choose Download JPEG instead.");
  }
  const file = new FileType([item.blob], safePhotoName(item.name), {
    type: item.type || "image/jpeg",
    lastModified: item.savedAt
  });
  if (typeof navigatorObject.canShare === "function" &&
      !navigatorObject.canShare({ files: [file] })) {
    throw Error("Sharing this photo is unsupported. Use Download JPEG instead.");
  }
  // Important: do not await before navigator.share; iOS requires a real tap.
  return navigatorObject.share({ files: [file], title: "LightCraft edited photo" });
}

export function downloadSavedPhoto(item, documentObject = document, urls = URL) {
  if (!item?.blob) throw Error("Select a saved photo first.");
  const url = urls.createObjectURL(item.blob);
  try {
    const a = documentObject.createElement("a");
    a.href = url;
    a.download = safePhotoName(item.name);
    a.rel = "noopener";
    a.click();
  } finally {
    const timer = setTimeout(() => urls.revokeObjectURL(url), 60000);
    timer?.unref?.();
  }
}
