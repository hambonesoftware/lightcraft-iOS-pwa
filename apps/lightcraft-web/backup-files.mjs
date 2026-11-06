/**
 * LightCraft PWA library backup handoff.
 *
 * A prepared ZIP is still only in WebKit-managed memory until the user chooses
 * "Save to Files" in the iOS share sheet, or downloads it and verifies its
 * location in Files. We never claim that preparing or sharing proves a save.
 *
 * A separate user click is essential: Safari's Web Share API requires a
 * transient user gesture. Rust's async ZIP assembly cannot call share().
 */
export function createBackupHandoff({
  navigatorObject,
  documentObject,
  urlObject,
  FileConstructor,
  onReady = () => {},
  onNotice = () => {}
}) {
  let prepared = null;
  let generation = 0;

  function stage(blob, filename) {
    if (!blob || typeof blob.size !== "number" || blob.size <= 0 ||
        !/^lightcraft-library-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(filename)) {
      throw new TypeError("Invalid LightCraft library backup");
    }
    generation += 1;
    prepared = { blob, filename, generation };
    onReady({ filename, size: blob.size });
    onNotice("Backup prepared, but NOT saved. Tap Share / Save to Files and verify the ZIP in Files.");
  }

  function requirePrepared() {
    if (!prepared) {
      throw new Error("Prepare a library backup before saving it to Files.");
    }
    return prepared;
  }

  function canShare() {
    if (!prepared || typeof navigatorObject?.canShare !== "function" ||
        typeof navigatorObject?.share !== "function" ||
        typeof FileConstructor !== "function") {
      return false;
    }
    const file = new FileConstructor(
      [prepared.blob], prepared.filename, { type: "application/zip" }
    );
    try {
      return navigatorObject.canShare({ files: [file] }) === true;
    } catch {
      return false;
    }
  }

  // Call this synchronously from the actual share button's click handler;
  // invoking navigator.share only after awaiting another Promise loses user
  // activation on Safari.
  async function sharePrepared() {
    const ready = requirePrepared();
    if (typeof navigatorObject?.share !== "function" ||
        typeof navigatorObject?.canShare !== "function" ||
        typeof FileConstructor !== "function") {
      throw new Error("File sharing isn't available here. Use Download backup.");
    }
    const file = new FileConstructor(
      [ready.blob], ready.filename, { type: "application/zip" }
    );
    if (!navigatorObject.canShare({ files: [file] })) {
      throw new Error("This backup is too large or unsupported for sharing. Use Download backup.");
    }
    // DO NOT await before this call.
    await navigatorObject.share({
      title: "LightCraft photo library backup",
      files: [file]
    });
    onNotice("Sharing finished. Confirm the ZIP exists in Files → On My iPhone before clearing any website data.");
  }

  function downloadPrepared() {
    const ready = requirePrepared();
    if (!urlObject || typeof urlObject.createObjectURL !== "function" ||
        !documentObject || typeof documentObject.createElement !== "function") {
      throw new Error("This browser cannot download backup files.");
    }
    const url = urlObject.createObjectURL(ready.blob);
    try {
      const link = documentObject.createElement("a");
      link.href = url;
      link.download = ready.filename;
      link.rel = "noopener";
      link.click();
      onNotice("Backup download requested. Verify the ZIP in Files → Downloads or On My iPhone.");
    } finally {
      // Safari can keep reading the URL after the click event has returned.
      setTimeout(() => urlObject.revokeObjectURL?.(url), 60_000);
    }
  }

  return Object.freeze({
    stage,
    sharePrepared,
    downloadPrepared,
    canShare,
    isPrepared: () => prepared !== null,
    getPreparedName: () => prepared?.filename ?? null
  });
}
