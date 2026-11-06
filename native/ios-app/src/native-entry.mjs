/**
 * This file is built into native-storage.js only inside the installed iOS app.
 * The hosted PWA never bundles the Capacitor native filesystem plugin.
 */
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { createNativeStorage } from "./storage-adapter.mjs";

export async function initializeLightCraftNativeStorage() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") {
    throw new Error("Native Documents storage requires the installed iOS application");
  }
  // Test the plugin before allowing the Rust editor to initialize. Failing
  // closed avoids silently writing new photos into transient WebKit storage.
  await Filesystem.mkdir({
    path: "LightCraft", directory: Directory.Documents, recursive: true
  }).catch(error => {
    if (String(error?.code) !== "OS-PLUG-FILE-0010") throw error;
  });
  const adapter = createNativeStorage(Filesystem, Directory.Documents);
  const probe = "__native-storage-probe__";
  await adapter.write({ path: probe, bytes: new Uint8Array([76, 67, 1]) });
  const verified = await adapter.read({ path: probe });
  if (!verified || verified.length !== 3 || verified[0] !== 76 || verified[1] !== 67 || verified[2] !== 1) {
    throw new Error("Native Documents storage write/read check failed");
  }
  await adapter.remove({ path: probe });
  globalThis.__lightcraftNativeStorage = adapter;
}
