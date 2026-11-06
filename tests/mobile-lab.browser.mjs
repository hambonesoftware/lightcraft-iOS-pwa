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
try {
  const response = await page.goto(base + "/mobile-lab.html", { waitUntil: "domcontentloaded", timeout: 90000 });
  assert.equal(response?.status(), 200);
  // The wrapper has no own box (all its content is fixed-position), so
  // Playwright considers that wrapper invisible even while its UI is rendered.
  await page.locator(".studio-header").waitFor({ state: "visible", timeout: 120000 });
  assert.equal(await page.locator("#mobile_studio").evaluate(el => el.hidden), false);
  await page.waitForFunction(() => !!globalThis.lightcraft?.command, { timeout: 30000 });

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
  await page.waitForFunction(async filename => {
    try {
      const result = JSON.parse(await lightcraft.command("catalog.query", JSON.stringify({ limit: 200 })));
      return result.photos.some(photo => photo.fileName === filename);
    } catch {
      return false;
    }
  }, fixtureName, { timeout: 60000 });
  const fixture = await page.evaluate(async filename => {
    const data = JSON.parse(await lightcraft.command("catalog.query", JSON.stringify({ limit: 200 })));
    return data.photos.find(photo => photo.fileName === filename);
  }, fixtureName);
  assert.ok(Number.isSafeInteger(fixture.id), "new photo must have a real Rust catalog ID");
  await page.evaluate(async id => {
    await lightcraft.command("library.select", JSON.stringify({ ids: [id], active: id }));
    await lightcraft.command("view.zoomFit", "{}");
  }, fixture.id);
  // A new empty library opens its native library sheet automatically.
  if (await page.locator("#library_dialog").evaluate(dialog => dialog.open)) {
    await page.getByRole("button", { name: "Close library" }).click();
  }
  await page.getByRole("tab", { name: "Light" }).click();
  await page.screenshot({ path: reportDir + "/phone-light.png", fullPage: true });

  await page.getByRole("tab", { name: "Color" }).click();
  assert.equal(await page.getByRole("tab", { name: "Color" }).getAttribute("aria-selected"), "true");
  await page.screenshot({ path: reportDir + "/phone-color.png", fullPage: true });
  await page.getByRole("tab", { name: "Effects" }).click();
  assert.equal(await page.getByRole("tab", { name: "Effects" }).getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "Open photo library" }).click();
  await page.getByRole("dialog", { name: "Local photo library" }).waitFor({ state: "visible" });
  await page.screenshot({ path: reportDir + "/phone-library.png", fullPage: true });

  // Verify the *HTML range event* reaches the actual Rust pipeline, updates
  // the selected photo and can be undone. Direct command calls alone would
  // miss the mobile UI integration we are trying to validate.
  await page.getByRole("button", { name: "Close library" }).click();
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
  await page.waitForFunction(async expected => {
    const values = JSON.parse(await lightcraft.command("develop.controls", JSON.stringify({ section: "light" })));
    const actual = values.find(control => control.id === "light.exposure");
    return actual && Math.abs(actual.value - expected) < 0.00001;
  }, next, { timeout: 20000 });
  await page.screenshot({ path: reportDir + "/phone-edit.png", fullPage: true });
  await page.evaluate(async () => lightcraft.command("edit.undo", "{}"));
  const undone = await page.evaluate(async () =>
    JSON.parse(await lightcraft.command("develop.controls", JSON.stringify({ section: "light" }))));
  const reverted = undone.find(control => control.id === "light.exposure");
  assert.ok(reverted && Math.abs(reverted.value - current.value) < 0.00001, "Undo restores original exposure");
  assert.deepEqual(errors, [], "browser page should not raise unhandled JavaScript errors");
  console.log("Mobile Studio browser smoke passed; screenshots in " + reportDir);
} finally {
  await context.close();
  await browser.close();
}
