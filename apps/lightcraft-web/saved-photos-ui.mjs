/**
 * Touch-first saved-image UI. The original Rust/WASM engine renders every JPEG.
 * Apple Photos receives a copy only through an explicit iOS share-sheet choice.
 */
import {
  createSavedPhotoRepository,
  createPhotoSaveWorkflow,
  shareSavedPhoto,
  downloadSavedPhoto
} from "./saved-photos.mjs";
/**
 * A full-size 24 MP Rust export can peak above 1 GB. iOS Safari may kill the
 * PWA without a catchable JavaScript error. The mobile Save default uses the
 * engine's lower-memory 2048-pixel preview pipeline instead, without changing
 * the original or its edit settings. No upscaling of smaller photographs.
 */
export const MOBILE_SAVE_MAX_EDGE = 2048;

export function mobileSaveExportParams(photo, id) {
  if (!Number.isSafeInteger(id) || id < 0) throw Error("Select a valid photo.");
  const stem = String(photo?.fileName || "LightCraft")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .slice(0, 80) || "LightCraft";
  return {
    ids: [id],
    path: stem + "-LightCraft.jpg",
    format: "jpeg",
    quality: 90,
    longEdge: MOBILE_SAVE_MAX_EDGE,
    dontEnlarge: true,
    colorSpace: "srgb"
  };
}


export function mountSavedPhotosUI({ call, getSelectedPhoto, getSelectedId, notify, closeLibrary }) {
  const el = id => document.getElementById(id);
  const repository = createSavedPhotoRepository();
  const workflow = createPhotoSaveWorkflow(repository);
  const resultDialog = el("save_result_dialog");
  const poolDialog = el("saved_pool_dialog");
  let selected = null;
  let previewUrl = null;
  let poolUrls = [];
  let poolGeneration = 0;

  // The Rust exporter calls this synchronously with its real image Blob.
  // A call outside an active Save is allowed to use normal web download.
  globalThis.lightcraftReceivePhotoExport = (blob, filename) => workflow.accept(blob, filename);

  function releasePoolPreviews() {
    poolGeneration += 1;
    for (const url of poolUrls) URL.revokeObjectURL(url);
    poolUrls = [];
  }

  async function updateCount() {
    try {
      const entries = await repository.list();
      el("saved_pool_badge").textContent = "(" + entries.length + ")";
    } catch (error) {
      el("saved_pool_badge").textContent = "";
      console.warn("Saved pool is unavailable", error);
    }
  }

  async function showResult(item) {
    const full = item?.blob ? item : await repository.get(item?.id);
    if (!full) throw Error("The saved photo could not be found.");
    if (poolDialog.open) poolDialog.close();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    selected = full;
    // The photo is already visible in the editor. Decoding it a second time
    // behind this dialog can double WebKit's image memory immediately after
    // the Rust export has just peaked. Keep the share UI lightweight.
    const preview = el("saved_photo_preview");
    preview.removeAttribute("src");
    preview.hidden = true;
    el("saved_photo_name").textContent = full.name +
      " · " + (full.size / (1024 * 1024)).toFixed(1) + " MB";
    if (!resultDialog.open) resultDialog.showModal();
  }

  async function renderPool() {
    releasePoolPreviews();
    const generation = poolGeneration;
    const container = el("saved_pool_items");
    container.replaceChildren();
    el("saved_pool_count").textContent = "Loading saved photos…";
    const entries = await repository.list();
    el("saved_pool_badge").textContent = "(" + entries.length + ")";
    el("saved_pool_count").textContent = entries.length +
      (entries.length === 1 ? " finished photo" : " finished photos");
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "empty-adjustments";
      empty.textContent = "No finished photos yet. Import, edit, then tap Save.";
      container.append(empty);
      return;
    }
    let visible = 0;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "backup-button";
    more.textContent = "Show more saved photos";
    function appendBatch() {
      const batch = entries.slice(visible, visible + 8);
      visible += batch.length;
      for (const item of batch) {
        const row = document.createElement("div");
        row.className = "saved-pool-item";
        const open = document.createElement("button");
        open.type = "button";
        open.className = "saved-pool-open";
        const thumbnail = document.createElement("img");
        thumbnail.className = "saved-pool-thumbnail";
        thumbnail.alt = "";
        thumbnail.loading = "lazy";
        const details = document.createElement("span");
        details.className = "saved-pool-details";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const meta = document.createElement("small");
        meta.textContent = new Date(item.savedAt).toLocaleString() +
          " · " + (item.size / (1024 * 1024)).toFixed(1) + " MB";
        details.append(name, meta);
        open.append(thumbnail, details);
        open.addEventListener("click", () => {
          showResult(item).catch(error => notify(String(error)));
        });
        const remove = document.createElement("button");
        remove.className = "saved-pool-delete";
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", "Remove " + item.name + " from Saved pool");
        remove.addEventListener("click", async () => {
          if (!window.confirm("Remove this saved export from LightCraft? Photos copies will not be removed.")) return;
          try {
            await repository.remove(item.id);
            await renderPool();
          } catch (error) {
            notify("Cannot remove saved export: " + String(error));
          }
        });
        row.append(open, remove);
        container.append(row);

        // Only the visible batch requests JPEG blobs. Database metadata is flat
        // and lightweight; thumbnail object URLs are revoked on dialog close.
        // Large legacy exports can use hundreds of MB when the browser
        // decodes their thumbnails. Keep them as text-only entries, still
        // fully available for sharing without a second image decode.
        if (item.size <= 3 * 1024 * 1024) {
          repository.get(item.id).then(photo => {
            if (!photo || generation !== poolGeneration || !poolDialog.open) return;
            const url = URL.createObjectURL(photo.blob);
            poolUrls.push(url);
            thumbnail.src = url;
          }).catch(error => console.warn("Could not load photo thumbnail", error));
        } else {
          thumbnail.replaceWith(document.createTextNode("JPG"));
        }
      }
      more.hidden = visible >= entries.length;
      container.append(more);
    }
    more.addEventListener("click", appendBatch);
    appendBatch();
  }

  async function savePhoto() {
    const photo = getSelectedPhoto();
    const id = getSelectedId();
    if (!photo || id === null) throw Error("Select a photograph before saving.");
    const params = mobileSaveExportParams(photo, id);
    const saveButton = el("export_photo");
    saveButton.disabled = true;
    notify("Saving edited JPEG (up to 2048 px) for iPhone…");
    try {
      const saved = await workflow.saveThrough(async () => {
        const response = await call("app.export", params);
        if (response?.error) throw Error(String(response.error));
        const failedFile = response?.files?.find?.(file => file?.error);
        if (failedFile) throw Error(String(failedFile.error));
      }, photo.fileName || "");
      await updateCount();
      await showResult(saved);
      notify("Saved locally. Choose Share to Photos → Save Image for your Photos copy.");
      return saved;
    } finally {
      saveButton.disabled = getSelectedId() === null;
    }
  }

  el("open_saved_pool").addEventListener("click", () => {
    closeLibrary();
    if (!poolDialog.open) poolDialog.showModal();
    renderPool().catch(error => {
      el("saved_pool_count").textContent = "Could not read saved photos: " + String(error);
    });
  });
  el("close_saved_pool").addEventListener("click", () => poolDialog.close());
  poolDialog.addEventListener("close", releasePoolPreviews);
  el("finish_save").addEventListener("click", () => resultDialog.close());
  resultDialog.addEventListener("close", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    selected = null;
    el("saved_photo_preview").removeAttribute("src");
  });
  el("share_saved_photo").addEventListener("click", () => {
    try {
      // No await before invoking the iOS share sheet: a second real tap
      // preserves Safari's required transient user activation.
      const sharePromise = shareSavedPhoto(selected, navigator, File);
      Promise.resolve(sharePromise)
        .then(() => notify("Sharing finished. Check Photos to confirm you chose Save Image."))
        .catch(error => {
          if (error?.name !== "AbortError") notify("Sharing unavailable: " + String(error));
        });
    } catch (error) {
      notify(String(error));
    }
  });
  el("download_saved_photo").addEventListener("click", () => {
    try {
      downloadSavedPhoto(selected);
      notify("Download requested. Verify the image in Files.");
    } catch (error) {
      notify(String(error));
    }
  });

  return Object.freeze({
    savePhoto,
    updateCount,
    isSaving: () => workflow.isSaving()
  });
}
