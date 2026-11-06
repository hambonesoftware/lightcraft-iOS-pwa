/**
 * LightCraft Mobile Studio — experiment, NOT a second image-processing engine.
 *
 * HTML handles touch targets, accessibility, sheets, and responsive layout.
 * The existing Rust/WASM command bridge supplies the catalog and all edits.
 * The existing egui loupe is the sole source of displayed photo pixels.
 * No photo data is sent to a server or saved in an alternate browser store.
 */

import { createBackupHandoff } from "./backup-files.mjs";
import { mountSavedPhotosUI } from "./saved-photos-ui.mjs";
import { createLatestValueScheduler } from "./mobile-performance.mjs";
import { mountPhotoGestures } from "./mobile-gestures.mjs";

export const CATEGORY_SECTIONS = Object.freeze({
  looks: [],
  light: ["light", "curve"],
  color: ["color", "mixer", "bwMix", "grading", "pointColor", "calibration"],
  effects: ["effects", "vignette", "grain"],
  detail: ["detail"],
  optics: ["optics", "geometry", "profile"]
});

export const CATEGORY_LABELS = Object.freeze({
  looks: "Looks",
  light: "Light",
  color: "Color",
  effects: "Effects",
  detail: "Detail",
  optics: "Optics"
});

/** The engine reports controls with sections and current numeric values. */
export function controlsForCategory(controls, category) {
  const allowed = CATEGORY_SECTIONS[category] || [];
  return Array.isArray(controls)
    ? controls.filter(control => allowed.includes(control?.section) &&
        typeof control?.id === "string" &&
        Number.isFinite(control?.value) &&
        Number.isFinite(control?.min) &&
        Number.isFinite(control?.max) &&
        control.max > control.min)
    : [];
}

export function percentOf(spec, value = spec.value) {
  const n = (Number(value) - Number(spec.min)) / (Number(spec.max) - Number(spec.min));
  return Math.round(Math.min(100, Math.max(0, Number.isFinite(n) ? n * 100 : 0)));
}

export function formattedValue(spec, value) {
  const precision = Math.min(4, Math.max(0, Number(spec.decimals) || 0));
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const output = n.toFixed(precision);
  return n > 0 && Number(spec.min) < 0 ? "+" + output : output;
}

export function activePhotoId(libraryState) {
  const n = libraryState?.selection?.active;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function fileTypeLabel(photo) {
  const name = String(photo?.fileName ?? "Photograph");
  const type = name.includes(".") ? name.split(".").pop().toUpperCase() : "PHOTO";
  return type.slice(0, 5);
}

const el = id => document.getElementById(id);

export function mountMobileStudio({ command, importBrowserFiles, restoreBrowserBackupFile }) {
  if (typeof command !== "function" || typeof importBrowserFiles !== "function" || typeof restoreBrowserBackupFile !== "function") {
    throw new TypeError("LightCraft WASM bridge and native import function are required");
  }

  const root = el("mobile_studio");
  const loading = el("lightcraft_loading");
  const controlsContainer = el("adjustment_controls");
  const libraryDialog = el("library_dialog");
  const itemsContainer = el("library_items");
  const tabs = Array.from(document.querySelectorAll("[data-category]"));
  let activeCategory = "light";
  let activeId = null;
  let catalog = [];
  let specs = [];
  let presets = [];
  let lookGroup = "All";
  let lastAppliedPreset = null;
  let mutations = Promise.resolve();
  let toastTimer = null;
  const backupHandoff = createBackupHandoff({
    navigatorObject: navigator,
    documentObject: document,
    urlObject: URL,
    FileConstructor: File,
    onReady({ filename, size }) {
      const sizeMb = Math.max(0.1, Math.round((size / (1024 * 1024)) * 10) / 10);
      el("backup_message").textContent = filename + " (" + sizeMb + " MB) is ready. It is NOT saved in Files yet.";
      el("backup_ready").hidden = false;
    },
    onNotice(message) {
      notify(message);
    }
  });
  // The ZIP is staged by Rust; the next actual button tap opens iOS Share,
  // preserving Safari's transient user activation.
  globalThis.lightcraftReceiveBackup = (blob, filename) => backupHandoff.stage(blob, filename);
  const photoGestures = mountPhotoGestures({
    canvas: el("lightcraft_canvas"),
    viewport: el("lightcraft_viewport"),
    call,
    activePhoto: () => activeId !== null,
    onError: error => notify("Could not update zoom: " + String(error))
  });
  const savedPhotosUI = mountSavedPhotosUI({
    call,
    getSelectedPhoto: () => catalog.find(photo => photo.id === activeId),
    getSelectedId: () => activeId,
    notify,
    closeLibrary: () => libraryDialog.close()
  });


  async function call(name, params = {}) {
    const raw = await command(name, JSON.stringify(params));
    if (typeof raw !== "string") {
      throw new Error("Unexpected response from LightCraft: " + name);
    }
    return JSON.parse(raw);
  }

  async function checkStorageDurability() {
    const status = el("storage_status");
    if (!status) return;
    const storage = navigator.storage;
    if (!storage || typeof storage.persisted !== "function") {
      status.textContent = "This device does not report storage durability. Keep a separate photo backup.";
      return;
    }
    try {
      let persistent = await storage.persisted();
      if (!persistent && typeof storage.persist === "function") {
        // WebKit decides based on its own heuristics, including Home Screen use.
        // Never claim that this guarantees the files cannot be deleted.
        persistent = await storage.persist();
      }
      const estimate = typeof storage.estimate === "function"
        ? await storage.estimate().catch(() => null)
        : null;
      const usedMb = estimate && Number.isFinite(estimate.usage)
        ? " · approximately " + Math.round(estimate.usage / (1024 * 1024)) + " MB used"
        : "";
      status.textContent = persistent
        ? "Persistent web-app storage granted" + usedMb + ". Backups are still required."
        : "Web-app storage may be automatically evicted" + usedMb + ". Back up your originals.";
    } catch {
      status.textContent = "Storage protection could not be verified. Back up your originals.";
    }
  }

  function notify(message) {
    const toast = el("toast");
    toast.textContent = String(message);
    toast.hidden = false;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4400);
  }

  function submit(action, showSuccess = false) {
    const next = mutations.catch(() => {}).then(action);
    mutations = next;
    next.then(() => { if (showSuccess) notify("Photo changes saved locally"); })
      .catch(error => notify(String(error)));
    return next;
  }

  function updateHeader() {
    const photo = catalog.find(p => p.id === activeId);
    el("current_photo").textContent = photo?.fileName || "Select a photograph";
    el("undo").disabled = activeId === null;
    el("redo").disabled = activeId === null;
    el("export_photo").disabled = activeId === null || savedPhotosUI.isSaving();
    el("auto_correct").disabled = activeId === null || activeCategory !== "light";
    el("fit_photo").disabled = activeId === null;
    el("compare_photo").disabled = activeId === null;
  }


  function renderLooks() {
    controlsContainer.replaceChildren();
    controlsContainer.scrollTop = 0;
    if (activeId === null) {
      const empty = document.createElement("p");
      empty.className = "empty-adjustments";
      empty.textContent = "Choose a photograph to apply a look.";
      controlsContainer.append(empty);
      return;
    }

    const search = document.createElement("input");
    search.type = "search";
    search.className = "looks-search";
    search.placeholder = "Find a look";
    search.setAttribute("aria-label", "Search looks");
    const groups = ["All", "Favorites", ...new Set(presets.map(item => String(item.group || "Other")))];
    const picker = document.createElement("div");
    picker.className = "looks-groups";
    picker.setAttribute("aria-label", "Filter looks by group");
    const gallery = document.createElement("div");
    gallery.className = "looks-gallery";

    const draw = () => {
      picker.replaceChildren();
      for (const group of groups) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "looks-chip";
        chip.textContent = group;
        chip.setAttribute("aria-pressed", String(lookGroup === group));
        chip.addEventListener("click", () => {
          lookGroup = group;
          draw();
        });
        picker.append(chip);
      }
      gallery.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      const matching = presets.filter(preset =>
        (lookGroup === "All" ||
          (lookGroup === "Favorites" && preset.favorite) ||
          preset.group === lookGroup) &&
        (!query || String(preset.name).toLocaleLowerCase().includes(query))
      );
      for (const preset of matching.slice(0, 90)) {
        const item = document.createElement("div");
        item.className = "look-item";
        if (lastAppliedPreset === preset.id) item.classList.add("selected");
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "look-apply";
        apply.disabled = activeId === null;
        apply.setAttribute("aria-label", "Apply " + preset.name);
        const graphic = document.createElement("span");
        graphic.className = "look-symbol";
        graphic.setAttribute("aria-hidden", "true");
        graphic.textContent = "◈";
        const name = document.createElement("span");
        name.className = "look-name";
        name.textContent = String(preset.name);
        const group = document.createElement("span");
        group.className = "look-meta";
        group.textContent = String(preset.group || "Look");
        apply.append(graphic, name, group);
        apply.addEventListener("click", () => submit(async () => {
          await call("preset.apply", { id: preset.id, amount: 100 });
          lastAppliedPreset = preset.id;
          await refreshState();
        }));
        const favorite = document.createElement("button");
        favorite.type = "button";
        favorite.className = "look-favorite";
        favorite.textContent = preset.favorite ? "★" : "☆";
        favorite.setAttribute("aria-label", (preset.favorite ? "Remove favorite " : "Favorite ") + preset.name);
        favorite.setAttribute("aria-pressed", String(Boolean(preset.favorite)));
        favorite.addEventListener("click", () => submit(async () => {
          await call("preset.favorite", { id: preset.id, favorite: !preset.favorite });
          await refreshState();
        }));
        item.append(apply, favorite);
        gallery.append(item);
      }
      if (!matching.length) {
        const empty = document.createElement("p");
        empty.className = "empty-adjustments";
        empty.textContent = presets.length ? "No looks match your search." : "No looks are available.";
        gallery.append(empty);
      } else if (matching.length > 90) {
        const more = document.createElement("p");
        more.className = "look-overflow";
        more.textContent = "Showing 90 of " + matching.length + " looks. Use search or a group to narrow the list.";
        gallery.append(more);
      }
    };
    search.addEventListener("input", draw);
    controlsContainer.append(search, picker, gallery);
    draw();
  }

  function renderControls() {
    el("panel_title").textContent = CATEGORY_LABELS[activeCategory] || "Adjustments";
    if (activeCategory === "looks") {
      renderLooks();
      updateHeader();
      return;
    }
    const all = controlsForCategory(specs, activeCategory);
    controlsContainer.replaceChildren();
    controlsContainer.scrollTop = 0;
    if (activeId === null || all.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-adjustments";
      empty.textContent = activeId === null
        ? "Choose a photograph from your library to begin editing."
        : "No controls are currently available in this category.";
      controlsContainer.append(empty);
      updateHeader();
      return;
    }

    for (const spec of all) {
      const row = document.createElement("div");
      row.className = "control-row";
      const top = document.createElement("div");
      top.className = "control-top";
      const label = document.createElement("label");
      label.className = "control-label";
      label.textContent = String(spec.label || spec.id);
      const valueText = document.createElement("output");
      valueText.className = "control-value";
      valueText.textContent = formattedValue(spec, spec.value);

      const range = document.createElement("input");
      range.className = "control-range";
      range.type = "range";
      range.id = "control_" + spec.id.replace(/[^a-zA-Z0-9]/g, "_");
      range.min = String(spec.min);
      range.max = String(spec.max);
      range.step = String(Number(spec.step) > 0 ? spec.step : "any");
      range.value = String(spec.value);
      range.setAttribute("aria-label", String(spec.label || spec.id));
      range.style.setProperty("--percent", percentOf(spec) + "%");
      label.htmlFor = range.id;

      let editing = false;
      let finishing = false;
      const scheduler = createLatestValueScheduler(
        value => submit(() => call("develop.set", { control: spec.id, value })),
        { onError: error => notify(String(error)) }
      );

      function begin() {
        if (editing || finishing) return;
        editing = true;
        // The serial command queue guarantees beginInteraction precedes the
        // first live value. Intermediate input events never fill that queue.
        submit(() => call("develop.beginInteraction", { label: String(spec.label || "Adjustment") }));
      }

      range.addEventListener("pointerdown", begin);
      range.addEventListener("input", () => {
        const value = Number(range.value);
        valueText.textContent = formattedValue(spec, value);
        range.style.setProperty("--percent", percentOf(spec, value) + "%");
        if (!editing && !finishing) begin();
        if (!finishing) scheduler.push(value);
      });

      range.addEventListener("change", () => {
        if (finishing) return;
        if (!editing) begin();
        finishing = true;
        const finalValue = Number(range.value);
        // The final value must reach Rust *before* endInteraction to preserve
        // a single correct undo step, even if the render worker is busy.
        scheduler.flush(finalValue)
          .then(() => submit(() => call("develop.endInteraction")))
          .then(() => refreshState())
          .catch(error => notify(String(error)))
          .finally(() => {
            editing = false;
            finishing = false;
          });
      });

      range.addEventListener("pointercancel", () => {
        if (!editing || finishing) return;
        finishing = true;
        scheduler.cancel()
          .then(() => submit(() => call("develop.cancelInteraction")))
          .catch(error => notify(String(error)))
          .finally(() => {
            editing = false;
            finishing = false;
          });
      });

      top.append(label, valueText);
      row.append(top, range);
      controlsContainer.append(row);
    }
    updateHeader();
  }

  function renderLibrary() {
    itemsContainer.replaceChildren();
    el("library_count").textContent = catalog.length +
      (catalog.length === 1 ? " photograph" : " photographs");
    if (catalog.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-adjustments";
      empty.textContent = "Your library is empty. Import a photo to begin.";
      itemsContainer.append(empty);
      return;
    }
    for (const photo of catalog) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "library-item";
      const mark = document.createElement("span");
      mark.className = "file-mark";
      mark.textContent = fileTypeLabel(photo);
      const description = document.createElement("span");
      description.style.minWidth = "0";
      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = String(photo.fileName || "Photograph");
      const meta = document.createElement("span");
      meta.className = "file-meta";
      meta.textContent = [photo.width, photo.height].every(Number.isFinite)
        ? photo.width + " × " + photo.height + (photo.edited ? " · Edited" : "")
        : (photo.edited ? "Edited" : "Imported");
      description.append(name, meta);
      button.append(mark, description);
      button.addEventListener("click", () => {
        submit(async () => {
          await call("library.select", { ids: [photo.id], active: photo.id });
          await call("view.zoomFit");
          activeId = photo.id;
          lastAppliedPreset = null;
          await refreshState();
          libraryDialog.close();
        });
      });
      itemsContainer.append(button);
    }
  }

  async function refreshState() {
    const [library, controls, photos, availablePresets] = await Promise.all([
      call("library.state"),
      call("develop.controls"),
      call("catalog.query", { filter: {}, limit: 200, offset: 0 }),
      call("presets.list")
    ]);
    const selected = activePhotoId(library);
    if (selected !== activeId) lastAppliedPreset = null;
    activeId = selected;
    catalog = Array.isArray(photos?.photos) ? photos.photos : [];
    specs = Array.isArray(controls) ? controls : [];
    presets = Array.isArray(availablePresets) ? availablePresets : [];
    renderLibrary();
    renderControls();
    if (activeId !== null) photoGestures.refresh().catch(() => {});
  }

  async function waitForWasmReady() {
    // WASM module initialization finishes before the eframe runner's first
    // library pass. Requests can queue until that pass, so retry connection
    // failures but never silently open a separate demo/photo catalog.
    for (let count = 0; count < 25; count++) {
      try {
        const state = await call("library.state");
        if (state && state.selection) return;
      } catch (error) {
        if (count === 24) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    throw new Error("LightCraft's Rust engine did not become ready.");
  }

  function useCategory(category) {
    if (!CATEGORY_SECTIONS[category]) return;
    activeCategory = category;
    if (document.documentElement.classList.contains("studio-immersive")) {
      document.documentElement.classList.remove("studio-immersive");
      el("panel_toggle").setAttribute("aria-expanded", "true");
      el("panel_toggle").setAttribute("aria-label", "Collapse adjustments");
    }
    for (const tab of tabs) {
      const active = tab.dataset.category === category;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    renderControls();
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => useCategory(tab.dataset.category));
    tab.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length];
      useCategory(next.dataset.category);
      next.focus();
    });
  }
  el("panel_toggle").addEventListener("click", () => {
    const expanded = document.documentElement.classList.toggle("studio-immersive") === false;
    el("panel_toggle").setAttribute("aria-expanded", String(expanded));
    el("panel_toggle").setAttribute("aria-label", expanded ? "Collapse adjustments" : "Expand adjustments");
  });
  el("mobile_notice_open").addEventListener("click", () => {
    el("mobile_notice_dialog").showModal();
  });
  el("mobile_notice_close").addEventListener("click", () => {
    el("mobile_notice_dialog").close();
    el("mobile_notice").hidden = true;
  });
  el("open_library").addEventListener("click", () => {
    renderLibrary();
    libraryDialog.showModal();
  });
  el("close_library").addEventListener("click", () => libraryDialog.close());
  el("import_photo").addEventListener("click", () => el("files_picker").click());
  el("backup_library").addEventListener("click", () => {
    notify("Preparing a complete library ZIP, including originals and edits…");
    submit(() => call("file.backupLibrary"));
  });
  el("share_backup").addEventListener("click", () => {
    // Safari requires the share call directly within the user's tap.
    backupHandoff.sharePrepared().catch(error => {
      if (error?.name === "AbortError") {
        notify("Sharing canceled. The backup is still ready; tap Save to Files again.");
      } else {
        notify(String(error?.message || error) + " You can also use Download backup.");
      }
    });
  });
  el("download_backup").addEventListener("click", () => {
    try {
      backupHandoff.downloadPrepared();
    } catch (error) {
      notify(String(error?.message || error));
    }
  });
  el("restore_backup").addEventListener("click", () => {
    if (!window.confirm("Restore a complete LightCraft backup ZIP? The existing library stays in storage, but the restored library becomes active.")) return;
    el("restore_backup_picker").click();
  });
  el("restore_backup_picker").addEventListener("change", event => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      notify("Choose a LightCraft library backup ZIP.");
      return;
    }
    // Rust verifies hashes before switching the active library pointer.
    restoreBrowserBackupFile(file);
    notify("Validating backup ZIP and restoring the local photo library…");
  });

  // Call WASM during a native file input change, not inside a future command
  // turn: this retains a genuine user file-selection gesture on iOS.
  el("files_picker").addEventListener("change", event => {
    const files = event.currentTarget.files;
    if (!files || files.length === 0) return;
    const count = files.length;
    importBrowserFiles(files);
    event.currentTarget.value = "";
    notify("Importing " + count + (count === 1 ? " photograph" : " photographs") + " into the local library…");
    // Import processing is asynchronous; refresh a few times so the new
    // catalog entries appear when the Rust import queue finishes.
    let tries = 0;
    const refreshImported = async () => {
      try { await refreshState(); } catch (error) { notify(String(error)); }
      tries++;
      if (tries < 12) setTimeout(refreshImported, 900);
    };
    setTimeout(refreshImported, 800);
  });

  el("undo").addEventListener("click", () => submit(async () => {
    await call("edit.undo");
    await refreshState();
  }));
  el("redo").addEventListener("click", () => submit(async () => {
    await call("edit.redo");
    await refreshState();
  }));
  const runZoomAction = name => submit(async () => {
    photoGestures.reset();
    await call(name);
    // A canvas pass applies the Rust viewport change before we snapshot it
    // for the next GPU-composited touch gesture.
    await new Promise(resolve => requestAnimationFrame(resolve));
    await photoGestures.refresh();
  });
  el("zoom_out").addEventListener("click", () => runZoomAction("view.zoomOut"));
  el("zoom_in").addEventListener("click", () => runZoomAction("view.zoomIn"));
  el("fit_photo").addEventListener("click", () => runZoomAction("view.zoomFit"));
  el("compare_photo").addEventListener("click", () => submit(() => call("view.beforeAfter")));
  el("auto_correct").addEventListener("click", () => submit(async () => {
    await call("develop.auto");
    await refreshState();
  }));
  el("export_photo").addEventListener("click", () => submit(() => savedPhotosUI.savePhoto()));

  (async () => {
    try {
      await waitForWasmReady();
      await refreshState();
      checkStorageDurability().catch(() => {});
      savedPhotosUI.updateCount().catch(() => {});
      root.hidden = false;
      loading.hidden = true;
      loading.style.display = "none";
      if (activeId !== null) await call("view.zoomFit");
      if (activeId === null) libraryDialog.showModal();
    } catch (error) {
      console.error(error);
      loading.textContent = "LightCraft Studio could not initialize: " + String(error);
    }
  })();

  return { refreshState, useCategory };
}
