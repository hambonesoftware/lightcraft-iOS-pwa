/**
 * Native iOS Documents backend for LightCraft.
 *
 * This adapter is deliberately a pure module: the Capacitor plugin is injected
 * by native-entry.mjs, while tests can supply an in-memory fake. The web build
 * NEVER imports this unless it is running inside the native Capacitor host.
 *
 * Each catalog key stays under Documents/LightCraft/. The Rust engine retains
 * its existing library layout and content-addressed originals.
 */
const MISSING = "OS-PLUG-FILE-0008";
const DIRECTORY_EXISTS = "OS-PLUG-FILE-0010";
const ROOT = "LightCraft";

export function nativeKey(path = "") {
  if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") ||
      (path !== "" && path.split("/").some(segment => segment === "" || segment === "." || segment === "..")) ||
      /[\u0000-\u001f]/.test(path)) {
    throw new Error("Unsafe LightCraft native storage path");
  }
  return path ? ROOT + "/" + path : ROOT;
}

function isMissing(error) {
  return String(error?.code || "") === MISSING;
}

function bytesToBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected bytes");
  let binary = "";
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  if (typeof base64 !== "string") throw new Error("Native file read did not return base64");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function createNativeStorage(filesystem, directory = "DOCUMENTS") {
  if (!filesystem || typeof filesystem.readFile !== "function" ||
      typeof filesystem.writeFile !== "function") {
    throw new TypeError("Native iOS Filesystem plugin not connected");
  }

  const at = path => ({ path: nativeKey(path), directory });

  // Per-path serialization prevents a read/modify/write collision between
  // concurrent requests from the Rust library flush queue.
  const locks = new Map();
  function serialize(path, work) {
    const prior = locks.get(path) || Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    locks.set(path, next);
    next.finally(() => {
      if (locks.get(path) === next) locks.delete(path);
    }).catch(() => {});
    return next;
  }

  async function readFile(path) {
    try {
      const result = await filesystem.readFile(at(path));
      return base64ToBytes(result.data);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async function putFile(path, bytes) {
    await filesystem.writeFile({
      ...at(path), data: bytesToBase64(bytes), recursive: true
    });
  }

  async function read({ path }) {
    return readFile(path);
  }
  async function write({ path, bytes }) {
    return serialize(path, () => putFile(path, bytes));
  }
  async function writeAt({ path, bytes, offset }) {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError("Invalid native journal offset");
    }
    return serialize(path, async () => {
      let info;
      try {
        info = await filesystem.stat(at(path));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }

      if (info && Number(info.size) === offset) {
        // The common journal case is an actual native append. No full-file
        // read, and no round trip through IndexedDB or OPFS.
        await filesystem.appendFile({
          ...at(path), data: bytesToBase64(bytes), recursive: true
        });
        return;
      }

      const previous = info ? await readFile(path) : null;
      if (info && previous === null) throw new Error("Native journal disappeared while writing");
      const prefix = previous ? previous.subarray(0, Math.min(previous.length, offset)) : new Uint8Array();
      const combined = new Uint8Array(prefix.length + bytes.length);
      combined.set(prefix);
      combined.set(bytes, prefix.length);
      await putFile(path, combined);
    });
  }
  async function exists({ path }) {
    try {
      await filesystem.stat(at(path));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }
  async function remove({ path }) {
    return serialize(path, async () => {
      try {
        await filesystem.deleteFile(at(path));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    });
  }
  async function list({ dir }) {
    try {
      const result = await filesystem.readdir(at(dir));
      return result.files.map(file => file.name);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }
  async function clear() {
    // Only called for the engine's explicit, confirmed ?reset command.
    await filesystem.rmdir({
      path: ROOT, directory, recursive: true
    }).catch(error => {
      if (!isMissing(error)) throw error;
    });
  }

  return Object.freeze({
    kind: "native-ios-documents",
    read, write, writeAt, exists, remove, list, clear
  });
}
