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
  await page.locator("#mobile_studio").waitFor({ state: "visible", timeout: 120000 });
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
  await page.screenshot({ path: reportDir + "/phone-light.png", fullPage: true });

  await page.getByRole("tab", { name: "Color" }).click();
  assert.equal(await page.getByRole("tab", { name: "Color" }).getAttribute("aria-selected"), "true");
  await page.screenshot({ path: reportDir + "/phone-color.png", fullPage: true });
  await page.getByRole("tab", { name: "Effects" }).click();
  assert.equal(await page.getByRole("tab", { name: "Effects" }).getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "Open photo library" }).click();
  await page.getByRole("dialog", { name: "Local photo library" }).waitFor({ state: "visible" });
  await page.screenshot({ path: reportDir + "/phone-library.png", fullPage: true });

  const availablePhotos = await page.evaluate(async () =>
    JSON.parse(await lightcraft.command("catalog.query", JSON.stringify({ limit: 5 }))));
  assert.ok(Array.isArray(availablePhotos.photos));
  if (availablePhotos.photos.length > 0) {
    const id = availablePhotos.photos[0].id;
    await page.evaluate(async id => {
      await lightcraft.command("library.select", JSON.stringify({ ids: [id], active: id }));
      await lightcraft.command("view.zoomFit", "{}");
    }, id);
    await page.getByRole("button", { name: "Close library" }).click();
    await page.getByRole("tab", { name: "Light" }).click();
    await page.waitForTimeout(600);
    const exposure = page.locator('input[aria-label="Exposure"]');
    if (await exposure.count()) {
      const before = await page.evaluate(async () => JSON.parse(await lightcraft.command("develop.controls", JSON.stringify({section:"light"}))));
      const current = before.find(c => c.id === "light.exposure");
      if (current && current.min < current.max) {
        // Test the real engine, independent of the UI's numeric formatting.
        const next = Math.min(current.max, Math.max(current.min, current.value + (current.step || 0.1)));
        await page.evaluate(async next => {
          await lightcraft.command("develop.beginInteraction", JSON.stringify({ label: "Exposure" }));
          await lightcraft.command("develop.set", JSON.stringify({ control: "light.exposure", value: next }));
          await lightcraft.command("develop.endInteraction", "{}");
        }, next);
        const after = await page.evaluate(async () => JSON.parse(await lightcraft.command("develop.controls", JSON.stringify({section:"light"}))));
        const changed = after.find(c => c.id === "light.exposure");
        assert.ok(changed && Math.abs(changed.value - next) < 0.00001, "Rust engine must apply exposure");
        await page.evaluate(async () => lightcraft.command("edit.undo", "{}"));
      }
      await page.screenshot({ path: reportDir + "/phone-edit.png", fullPage: true });
    }
  }
  assert.deepEqual(errors, [], "browser page should not raise unhandled JavaScript errors");
  console.log("Mobile Studio browser smoke passed; screenshots in " + reportDir);
} finally {
  await context.close();
  await browser.close();
}
