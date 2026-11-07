/**
 * Run after cargo xtask web while the built site is served at
 * http://127.0.0.1:8765. CI uses Playwright Chromium with a phone viewport.
 * This tests the REAL WebAssembly app and DOM shell, not a static mockup.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.LIGHTCRAFT_TEST_URL || "http://127.0.0.1:8765";
const browser = await chromium.launch({ headless: true });
const reportDir = "target/mobile-lab-screenshots";
await mkdir(reportDir, { recursive: true });
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  reducedMotion: "reduce"
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(String(error)));

/**
 * Poll the actual asynchronous Rust command, not an async predicate passed
 * to waitForFunction. This makes failures observable and avoids treating an
 * unresolved Promise handle as a successful condition.
 */
async function pollRust(commandName, params, predicate, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      last = await page.evaluate(async ({ commandName, params }) =>
        JSON.parse(await lightcraft.command(commandName, JSON.stringify(params))),
      { commandName, params });
      const value = predicate(last);
      if (value !== false && value !== undefined && value !== null) return value;
    } catch (error) {
      lastError = String(error);
    }
    await page.waitForTimeout(300);
  }
  throw new Error("Timed out checking " + commandName + ": " + JSON.stringify({ params, last, lastError }));
}

try {
  const response = await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  assert.equal(response?.status(), 200);
  // The wrapper has no own box (all its content is fixed-position), so
  // Playwright considers that wrapper invisible even while its UI is rendered.
  await page.locator(".studio-header").waitFor({ state: "visible", timeout: 120000 });
  assert.equal(await page.locator("#mobile_studio").evaluate(el => el.hidden), false);
  await page.waitForFunction(() => !!globalThis.lightcraft?.command, { timeout: 30000 });

  // Browser storage warnings must remain readable without the desktop
  // egui toast becoming gigantic and covering the photograph.
  const nativeNotice = page.locator("#mobile_notice");
  await page.waitForTimeout(250);
  if ((await page.locator("#mobile_notice_text").textContent())?.trim()) {
    assert.ok(await nativeNotice.isVisible(), "engine warnings must be presented as a native mobile notice");
    const warningHeight = await nativeNotice.evaluate(el => el.getBoundingClientRect().height);
    assert.ok(warningHeight <= 56, "storage notice must be compact rather than cover the photo");
    await page.locator("#mobile_notice_open").click();
    assert.ok(await page.locator("#mobile_notice_dialog").evaluate(el => el.open));
    assert.ok((await page.locator("#mobile_notice_text").textContent()).length > 20);
    await page.locator("#mobile_notice_close").click();
    assert.equal(await nativeNotice.isVisible(), false);
  }

  // The photo viewer must have a nonzero, nonoverlapping layout in a phone viewport.
  const geometry = await page.evaluate(() => {
    const rect = id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    return {
      header: rect("mobile_studio"),
      photo: rect("lightcraft_canvas"),
      footer: rect("current_photo"),
      controls: rect("adjustment_controls"),
      console: rect("category_tabs"),
      body: { height: window.innerHeight, width: window.innerWidth }
    };
  });
  assert.ok(geometry.photo.width >= 300, "photo viewport should fill phone");
  assert.ok(geometry.photo.height >= 120, "photo must retain meaningful visible area");
  assert.ok(geometry.photo.bottom <= geometry.footer.top + 2, "viewer must not overlap photo controls");
  assert.ok(geometry.controls.top >= geometry.footer.bottom, "editing controls must be below photo actions");
  assert.ok(geometry.console.bottom <= geometry.body.height + 1, "category nav must fit within phone screen");

  // Screenshot the real WASM canvas and native controls across key compact
  // viewport shapes. This catches landscape/iPad CSS rule collisions that a
  // successful Rust build or a single portrait screenshot cannot detect.
  for (const screen of [
    { width: 375, height: 667, name: "iphone-small" },
    { width: 852, height: 393, name: "iphone-landscape" },
    { width: 820, height: 1180, name: "ipad-portrait" }
  ]) {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    const dimensions = await page.evaluate(() => {
      const bounds = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height };
      };
      return {
        viewportHeight: window.innerHeight,
        header: bounds(".studio-header"),
        canvas: bounds("#lightcraft_canvas"),
        footer: bounds(".photo-footer"),
        sheet: bounds(".edit-console"),
        tabs: bounds("#category_tabs")
      };
    });
    assert.ok(dimensions.canvas.height >= 120,
      screen.name + ": photo must retain at least 120 points, got " + JSON.stringify(dimensions));
    assert.ok(dimensions.canvas.bottom <= dimensions.footer.top + 2,
      screen.name + ": photo must not be obscured by its footer");
    assert.ok(dimensions.footer.bottom <= dimensions.sheet.top + 2,
      screen.name + ": footer must not overlap editing sheet");
    assert.ok(dimensions.tabs.bottom <= dimensions.viewportHeight + 2,
      screen.name + ": correction categories must remain on-screen");
    await page.screenshot({ path: reportDir + "/" + screen.name + ".png", fullPage: true });
  }
  await page.setViewportSize({ width: 393, height: 852 });

  const state = await page.evaluate(async () => JSON.parse(await lightcraft.command("library.state", "{}")));
  assert.ok(state && state.selection, "expected the real Rust library state");
  const controls = await page.evaluate(async () => JSON.parse(await lightcraft.command("develop.controls", "{}")));
  assert.ok(Array.isArray(controls), "real engine should expose adjustment definitions");

  // Import a genuine generated PNG through the real DOM file input and Rust
  // Originals/OPFS pipeline. This prevents a misleading pass on an empty
  // library where no actual corrections were tested.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 168;
    const drawing = canvas.getContext("2d");
    drawing.fillStyle = "#34445e";
    drawing.fillRect(0, 0, 256, 168);
    drawing.fillStyle = "#d4a075";
    drawing.fillRect(0, 108, 256, 60);
    drawing.fillStyle = "#f8dca2";
    drawing.beginPath();
    drawing.arc(184, 53, 24, 0, Math.PI * 2);
    drawing.fill();
    const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    return Array.from(new Uint8Array(await png.arrayBuffer()));
  });
  const fixtureName = "lightcraft-studio-ci-fixture.png";
  await page.locator("#files_picker").setInputFiles({
    name: fixtureName,
    mimeType: "image/png",
    buffer: Buffer.from(bytes)
  });
  const returnedId = await pollRust("catalog.query", { filter: {}, limit: 200 },
    result => result.photos.find(photo => photo.fileName === fixtureName)?.id ?? false);
  const fixtureId = typeof returnedId === "string" && /^[0-9]+$/.test(returnedId) ? Number(returnedId) : returnedId;
  assert.ok(Number.isSafeInteger(fixtureId), "new photo must have a real Rust catalog ID: " + String(returnedId));

  // Choose the imported photo through the mobile library rather than bypassing the UI.
  if (!(await page.locator("#library_dialog").evaluate(dialog => dialog.open))) {
    await page.getByRole("button", { name: "Open photo library" }).click();
  }
  const fixtureRow = page.locator(".library-item").filter({ hasText: fixtureName });
  await fixtureRow.waitFor({ state: "visible", timeout: 20000 });
  await fixtureRow.click();
  await pollRust("library.state", {}, state => state.selection?.active === fixtureId, 20000);
  await page.locator("#library_dialog").waitFor({ state: "hidden" });
  await page.evaluate(async () => lightcraft.command("view.zoomFit", "{}"));
  await page.getByRole("tab", { name: "Light" }).click();

  // Two-finger mobile gestures must move the existing WebGL canvas immediately
  // while the Rust editor receives one final navigation commit after release.
  await pollRust("web.viewport", {}, view =>
    view?.imageRect?.width > 0 && view?.canvasRect?.width > 0 && view?.source ? view : false, 20000);
  await page.waitForTimeout(120);
  const compositorResponded = await page.evaluate(async () => {
    const canvas = document.getElementById("lightcraft_canvas");
    const viewport = document.getElementById("lightcraft_viewport");
    const rect = viewport.getBoundingClientRect();
    function send(type, positions) {
      const touches = positions.map(([x, y], id) => new Touch({
        identifier: id + 1, target: canvas,
        clientX: rect.left + x, clientY: rect.top + y,
        pageX: rect.left + x, pageY: rect.top + y
      }));
      const event = new TouchEvent(type, {
        touches, targetTouches: touches, changedTouches: touches,
        bubbles: true, cancelable: true
      });
      canvas.dispatchEvent(event);
    }
    const center = rect.width / 2;
    send("touchstart", [[center - 20, 120]]);
    send("touchstart", [[center - 20, 120], [center + 20, 120]]);
    send("touchmove", [[center - 37, 120], [center + 37, 120]]);
    await new Promise(resolve => requestAnimationFrame(resolve));
    const transformed = canvas.style.transform.includes("scale(");
    send("touchend", []);
    return transformed;
  });
  assert.equal(compositorResponded, true,
    "pinch should transform the existing canvas on the compositor, not wait for image rendering");
  await pollRust("web.viewport", {}, view =>
    view.zoom && typeof view.zoom === "object" && view.zoom.percent > 0, 20000);
  await page.waitForFunction(() => document.getElementById("lightcraft_canvas").style.transform === "",
    { timeout: 20000 });
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await pollRust("web.viewport", {}, view => view.zoom === "fit", 20000);

  await page.screenshot({ path: reportDir + "/phone-light.png", fullPage: true });

  await page.getByRole("tab", { name: "Color" }).click();
  assert.equal(await page.getByRole("tab", { name: "Color" }).getAttribute("aria-selected"), "true");
  await page.screenshot({ path: reportDir + "/phone-color.png", fullPage: true });
  await page.getByRole("tab", { name: "Looks" }).click();
  assert.equal(await page.getByRole("tab", { name: "Looks" }).getAttribute("aria-selected"), "true");
  const looks = await page.evaluate(async () =>
    JSON.parse(await lightcraft.command("presets.list", "{}")));
  assert.ok(Array.isArray(looks) && looks.length > 0, "real Rust preset list should be available");
  const firstLook = looks[0];
  const applyLook = page.getByRole("button", { name: "Apply " + firstLook.name, exact: true });
  await applyLook.waitFor({ state: "visible" });
  await applyLook.click();
  await pollRust("history.list", {}, state =>
    Array.isArray(state.history) && state.history.some(label => String(label).includes("Preset: " + firstLook.name)), 20000);
  await page.screenshot({ path: reportDir + "/phone-looks.png", fullPage: true });
  await page.getByRole("tab", { name: "Effects" }).click();
  assert.equal(await page.getByRole("tab", { name: "Effects" }).getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "Open photo library" }).click();
  await page.getByRole("dialog", { name: "Local photo library" }).waitFor({ state: "visible" });
  await page.screenshot({ path: reportDir + "/phone-library.png", fullPage: true });

  // Verify the *HTML range event* reaches the actual Rust pipeline, updates
  // the selected photo and can be undone. Direct command calls alone would
  // miss the mobile UI integration we are trying to validate.
  await page.getByRole("button", { name: "Close library" }).click();
  await page.locator("#panel_toggle").click();
  assert.equal(await page.locator("#panel_toggle").getAttribute("aria-expanded"), "false");
  const immersive = await page.locator("#lightcraft_canvas").evaluate(el => el.getBoundingClientRect().height);
  assert.ok(immersive >= 350, "collapsing inspector must make room for the photo");
  await page.locator("#panel_toggle").click();
  assert.equal(await page.locator("#panel_toggle").getAttribute("aria-expanded"), "true");
  await page.getByRole("tab", { name: "Light" }).click();
  const exposure = page.locator('input[aria-label="Exposure"]');
  await exposure.waitFor({ state: "visible", timeout: 20000 });
  const before = await page.evaluate(async () =>
    JSON.parse(await lightcraft.command("develop.controls", JSON.stringify({ section: "light" }))));
  const current = before.find(control => control.id === "light.exposure");
  assert.ok(current && current.min < current.max, "fixture must expose real exposure");
  const proposed = Math.min(current.max, Math.max(current.min, current.value + Math.max(current.step || 0.1, 0.25)));
  const next = Number(proposed.toFixed(2));
  await exposure.evaluate((range, newValue) => {
    range.value = String(newValue);
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
  }, next);
  await pollRust("develop.controls", { section: "light" }, values => {
    const actual = values.find(control => control.id === "light.exposure");
    return actual && Math.abs(actual.value - next) < 0.00001;
  }, 20000);
  await page.screenshot({ path: reportDir + "/phone-edit.png", fullPage: true });
  await page.evaluate(async () => lightcraft.command("edit.undo", "{}"));
  const undone = await page.evaluate(async () =>
    JSON.parse(await lightcraft.command("develop.controls", JSON.stringify({ section: "light" }))));
  const reverted = undone.find(control => control.id === "light.exposure");
  assert.ok(reverted && Math.abs(reverted.value - current.value) < 0.00001, "Undo restores original exposure");
  // Save must render through the actual Rust JPEG pipeline, persist a
  // real finished image in IndexedDB, and show the contextual Photos menu.
  await page.getByRole("button", { name: "Save edited photo" }).click();
  await page.locator("#save_result_dialog").waitFor({ state: "visible", timeout: 90000 });
  assert.match(await page.locator("#saved_photo_name").textContent(), /-LightCraft\.jpg$/);
  const finishedRecords = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const req = indexedDB.open("lightcraft-finished-photos");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const photos = await new Promise((resolve, reject) => {
      const req = database.transaction("items", "readonly").objectStore("items").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return photos.map(photo => ({ name: photo.name, size: photo.size }));
  });
  assert.equal(finishedRecords.length, 1, "Save must create one finished image in the flat local pool");
  assert.ok(finishedRecords[0].size > 100, "Saved item must contain JPEG bytes, not only a filename");
  const savedDownload = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: "Download image to Files" }).click();
  const exported = await savedDownload;
  assert.equal(exported.suggestedFilename(), finishedRecords[0].name);
  await page.getByRole("button", { name: "Close saved photo menu" }).click();
  await page.getByRole("button", { name: "Open photo library" }).click();
  await page.getByRole("button", { name: /Saved photos/ }).click();
  await page.locator(".saved-pool-item").first().waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await page.locator(".saved-pool-item").count(), 1);
  await page.locator(".saved-pool-open").first().click();
  await page.locator("#save_result_dialog").waitFor({ state: "visible" });
  await page.screenshot({ path: reportDir + "/phone-save-to-photos.png", fullPage: true });
  await page.getByRole("button", { name: "Close saved photo menu" }).click();

  // Reproduce the scenario tiny fixtures missed: saving a 12 MP photograph.
  // WebKit can terminate a PWA during an uncapped full-size JPEG export, so
  // this test verifies a real 4032 x 3024 source is encoded at <= 2048 px.
  const largeName = "lightcraft-twelve-megapixel-ci.jpg";
  const largeBytes = await page.evaluate(async () => {
    const source = document.createElement("canvas");
    source.width = 4032;
    source.height = 3024;
    const ctx = source.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, source.width, source.height);
    gradient.addColorStop(0, "#23354f");
    gradient.addColorStop(0.55, "#b78966");
    gradient.addColorStop(1, "#eed3aa");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, source.width, source.height);
    const blob = await new Promise(resolve => source.toBlob(resolve, "image/jpeg", 0.84));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.locator("#files_picker").setInputFiles({
    name: largeName,
    mimeType: "image/jpeg",
    buffer: Buffer.from(largeBytes)
  });
  const largeReturnedId = await pollRust("catalog.query", { filter: {}, limit: 200 },
    result => result.photos.find(photo => photo.fileName === largeName)?.id ?? false, 60000);
  const largePhotoId = typeof largeReturnedId === "string" && /^[0-9]+$/.test(largeReturnedId)
    ? Number(largeReturnedId) : largeReturnedId;
  assert.ok(Number.isSafeInteger(largePhotoId), "large import must yield a real Rust catalog ID");
  await page.getByRole("button", { name: "Open photo library" }).click();
  const largeRow = page.locator(".library-item").filter({ hasText: largeName });
  await largeRow.waitFor({ state: "visible", timeout: 20000 });
  await largeRow.click();
  await pollRust("library.state", {}, state => state.selection?.active === largePhotoId, 20000);
  await page.getByRole("button", { name: "Save edited photo" }).click();
  await page.locator("#save_result_dialog").waitFor({ state: "visible", timeout: 120000 });
  const largeSaved = await page.evaluate(async name => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("lightcraft-finished-photos");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const entries = await new Promise((resolve, reject) => {
      const req = db.transaction("items", "readonly").objectStore("items").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const entry = entries.find(item => item.name === name);
    if (!entry) return null;
    const image = await new Promise((resolve, reject) => {
      const req = db.transaction("images", "readonly").objectStore("images").get(entry.id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const bitmap = await createImageBitmap(image.blob);
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      size: image.blob.size,
      noDuplicatePreview: document.getElementById("saved_photo_preview").hidden
    };
    bitmap.close();
    return result;
  }, "lightcraft-twelve-megapixel-ci-LightCraft.jpg");
  assert.ok(largeSaved, "the 12 MP source must produce a saved JPEG");
  assert.ok(largeSaved.width <= 2048 && largeSaved.height <= 2048,
    "iPhone-safe output must not trigger a full-resolution render: " + JSON.stringify(largeSaved));
  assert.ok(Math.max(largeSaved.width, largeSaved.height) >= 1600,
    "large source should still yield a high-quality photographic export");
  assert.ok(largeSaved.size > 100, "large photo output must contain real JPEG bytes");
  assert.equal(largeSaved.noDuplicatePreview, true,
    "the Save dialog must not decode a second large image on iOS");
  await page.getByRole("button", { name: "Close saved photo menu" }).click();
  assert.deepEqual(errors, [], "browser page should not raise unhandled JavaScript errors");
  console.log("Mobile Studio browser smoke passed; screenshots in " + reportDir);
} catch (error) {
  console.error("Mobile Studio browser smoke failed:", error);
  console.error("Page errors:", errors);
  console.error("Loading message:", await page.locator("#lightcraft_loading").textContent().catch(() => "(unavailable)"));
  await page.screenshot({ path: reportDir + "/phone-failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
