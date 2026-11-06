/**
 * LightCraft Mobile Studio — experiment, NOT a second image-processing engine.
 *
 * HTML handles touch targets, accessibility, sheets, and responsive layout.
 * The existing Rust/WASM command bridge supplies the catalog and all edits.
 * The existing egui loupe is the sole source of displayed photo pixels.
 * No photo data is sent to a server or saved in an alternate browser store.
 */

export const CATEGORY_SECTIONS = Object.freeze({
  light: ["light", "curve"],
  color: ["color", "mixer", "bwMix", "grading", "pointColor", "calibration"],
  effects: ["effects", "vignette", "grain"],
  detail: ["detail"],
  optics: ["optics", "geometry", "profile"]
});

export const CATEGORY_LABELS = Object.freeze({
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

export function mountMobileStudio({ command, importBrowserFiles }) {
  if (typeof command !== "function" || typeof importBrowserFiles !== "function") {
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
  let busy = false;
  let mutations = Promise.resolve();
  let toastTimer = null;

  async function call(name, params = {}) {
    const raw = await command(name, JSON.stringify(params));
    if (typeof raw !== "string") {
      throw new Error("Unexpected response from LightCraft: " + name);
    }
    return JSON.parse(raw);
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
    el("export_photo").disabled = activeId === null;
    el("auto_correct").disabled = activeId === null || activeCategory !== "light";
    el("fit_photo").disabled = activeId === null;
    el("compare_photo").disabled = activeId === null;
  }

  function renderControls() {
    el("panel_title").textContent = CATEGORY_LABELS[activeCategory] || "Adjustments";
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
      let delayed = null;
      let requested = null;
      let interactionStarted = false;

      const begin = () => {
        if (editing) return;
        editing = true;
        submit(() => call("develop.beginInteraction", { label: String(spec.label || "Adjustment") }))
          .then(() => { interactionStarted = true; });
      };

      function send(value) {
        if (requested === value) return;
        requested = value;
        submit(() => call("develop.set", { control: spec.id, value }));
      }

      range.addEventListener("pointerdown", begin);
      range.addEventListener("input", () => {
        const value = Number(range.value);
        valueText.textContent = formattedValue(spec, value);
        range.style.setProperty("--percent", percentOf(spec, value) + "%");
        if (delayed !== null) clearTimeout(delayed);
        // Real preview during a gesture; the Rust interaction groups it
        // into one undo step. Dropping intermediate frames protects iOS RAM.
        delayed = setTimeout(() => {
          delayed = null;
          if (!editing) begin();
          send(value);
        }, 90);
      });

      range.addEventListener("change", () => {
        if (delayed !== null) clearTimeout(delayed);
        delayed = null;
        if (!editing) begin(); // keyboard and VoiceOver range changes
        send(Number(range.value));
        const finished = submit(async () => {
          await call("develop.endInteraction");
        });
        finished.then(() => {
          editing = false;
          interactionStarted = false;
          refreshState().catch(error => notify(String(error)));
        });
      });
      range.addEventListener("pointercancel", () => {
        if (delayed !== null) clearTimeout(delayed);
        delayed = null;
        if (editing || interactionStarted) {
          submit(() => call("develop.cancelInteraction")).finally(() => {
            editing = false;
            interactionStarted = false;
          });
        }
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
          await refreshState();
          libraryDialog.close();
        });
      });
      itemsContainer.append(button);
    }
  }

  async function refreshState() {
    const [library, controls, photos] = await Promise.all([
      call("library.state"),
      call("develop.controls"),
      call("catalog.query", { filter: {}, limit: 200, offset: 0 })
    ]);
    activeId = activePhotoId(library);
    catalog = Array.isArray(photos?.photos) ? photos.photos : [];
    specs = Array.isArray(controls) ? controls : [];
    renderLibrary();
    renderControls();
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
    for (const tab of tabs) {
      const active = tab.dataset.category === category;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    renderControls();
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => useCategory(tab.dataset.category));
  }
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
  el("fit_photo").addEventListener("click", () => submit(() => call("view.zoomFit")));
  el("compare_photo").addEventListener("click", () => submit(() => call("view.beforeAfter")));
  el("auto_correct").addEventListener("click", () => submit(async () => {
    await call("develop.auto");
    await refreshState();
  }));
  el("export_photo").addEventListener("click", () => submit(() => call("dialog.export")));

  (async () => {
    try {
      await waitForWasmReady();
      await refreshState();
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
