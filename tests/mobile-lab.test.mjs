import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATEGORY_SECTIONS,
  activePhotoId,
  controlsForCategory,
  fileTypeLabel,
  formattedValue,
  percentOf
} from "../apps/lightcraft-web/mobile-lab.mjs";

const html = readFileSync(new URL("../apps/lightcraft-web/index.html", import.meta.url), "utf8");
const preview = readFileSync(new URL("../apps/lightcraft-web/mobile-lab.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../apps/lightcraft-web/mobile-lab.css", import.meta.url), "utf8");
const rust = readFileSync(new URL("../apps/lightcraft-web/src/web.rs", import.meta.url), "utf8");

test("each focused correction tab maps to the actual engine section identifiers", () => {
  assert.deepEqual(CATEGORY_SECTIONS.light, ["light", "curve"]);
  assert.ok(CATEGORY_SECTIONS.color.includes("grading"));
  assert.deepEqual(CATEGORY_SECTIONS.detail, ["detail"]);
  assert.ok(CATEGORY_SECTIONS.optics.includes("optics"));
  assert.ok(Object.keys(CATEGORY_SECTIONS).length >= 6);
  assert.deepEqual(CATEGORY_SECTIONS.looks, []);
});

test("categories filter engine-returned control specs instead of inventing local filters", () => {
  const fromEngine = [
    { id: "light.exposure", section: "light", label: "Exposure", min: -5, max: 5, value: 1.1 },
    { id: "wb.tint", section: "color", label: "Tint", min: -100, max: 100, value: -2 },
    { id: "effects.clarity", section: "effects", label: "Clarity", min: -100, max: 100, value: 0 },
    { id: "unknown", section: "color", label: "Invalid", min: 5, max: 5, value: 5 },
    { id: "bad", section: "light", label: "Not numeric", min: 0, max: 1, value: Number.NaN }
  ];
  assert.deepEqual(controlsForCategory(fromEngine, "light").map(c => c.id), ["light.exposure"]);
  assert.deepEqual(controlsForCategory(fromEngine, "color").map(c => c.id), ["wb.tint"]);
  assert.deepEqual(controlsForCategory(fromEngine, "effects").map(c => c.id), ["effects.clarity"]);
  assert.deepEqual(controlsForCategory(fromEngine, "absent"), []);
});

test("slider readouts are bounded, precise and show positive signs where appropriate", () => {
  const control = { min: -4, max: 4, decimals: 2 };
  assert.equal(formattedValue(control, 0.65), "+0.65");
  assert.equal(formattedValue(control, -1.2), "-1.20");
  assert.equal(formattedValue(control, Number.NaN), "—");
  assert.equal(percentOf(control, -4), 0);
  assert.equal(percentOf(control, 0), 50);
  assert.equal(percentOf(control, 4), 100);
  assert.equal(percentOf(control, 100), 100);
  assert.equal(percentOf(control, -100), 0);
});

test("selected photo identity is read only from actual catalog selection", () => {
  assert.equal(activePhotoId({ selection: { active: 483 } }), 483);
  assert.equal(activePhotoId({ selection: { active: null } }), null);
  assert.equal(activePhotoId({}), null);
  assert.equal(fileTypeLabel({ fileName: "IMG_0598.DNG" }), "DNG");
  assert.equal(fileTypeLabel({ fileName: "portrait.jpeg" }), "JPEG");
});

test("mobile studio is the sole shipped PWA entry and uses original Rust engine", () => {
  assert.match(html, /<canvas id="lightcraft_canvas"/);
  assert.match(html, /import init, \{ start, command, import_browser_files \}/);
  assert.match(html, /mountMobileStudio\(\{ command, importBrowserFiles: import_browser_files \}\)/);
  assert.doesNotMatch(rust, /fn is_mobile_lab\(\) -> bool/);
  assert.doesNotMatch(rust, /self\.mobile_lab/);
  assert.match(html, /data-category="looks"/);
  assert.equal(html, preview);
  assert.match(html, /register\("\.\/sw\.js"/);
  assert.match(rust, /pub fn import_browser_files\(files: web_sys::FileList\)/);
  assert.match(rust, /self\.app\.ui\.fullscreen = fullscreen;/);
  assert.match(rust, /fn mobile_lab_notice\(text: &str\)/);
  assert.match(html, /id="mobile_notice"/);
  assert.match(html, /id="mobile_notice_dialog"/);
  assert.match(css, /\.mobile-notice \{/);
});

test("mobile layout honors device safe areas and reserves the photo canvas", () => {
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /#lightcraft_canvas\s*\{/);
  assert.match(css, /touch-action: none/);
  assert.match(css, /@media \(max-height: 620px\)/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="files_picker"/);
  assert.match(html, /id="panel_toggle"/);
  assert.match(html, /id="storage_status"/);
});

test("prototype does not contain a second fake image editing pipeline", () => {
  const js = readFileSync(new URL("../apps/lightcraft-web/mobile-lab.mjs", import.meta.url), "utf8");
  assert.match(js, /call\("develop\.set"/);
  assert.match(js, /call\("develop\.beginInteraction"/);
  assert.match(js, /call\("develop\.endInteraction"/);
  assert.match(js, /call\("library\.select"/);
  assert.match(js, /call\("develop\.controls"/);
  assert.match(js, /call\("presets\.list"/);
  assert.match(js, /call\("preset\.apply"/);
  assert.match(js, /call\("preset\.favorite"/);
  assert.match(js, /storage\.persist\(\)/);
  assert.match(js, /storage\.estimate\(\)/);
  assert.doesNotMatch(js, /getImageData|putImageData|ctx\.filter|canvas\.toDataURL|fetch\(["']https?:/);
});
