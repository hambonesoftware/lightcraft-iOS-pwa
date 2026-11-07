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
const savedUI = readFileSync(new URL("../apps/lightcraft-web/saved-photos-ui.mjs", import.meta.url), "utf8");
const safety = readFileSync(new URL("../apps/lightcraft-web/src/safety.rs", import.meta.url), "utf8");
const build = readFileSync(new URL("../xtask/src/web.rs", import.meta.url), "utf8");
const sw = readFileSync(new URL("../apps/lightcraft-web/sw.js", import.meta.url), "utf8");

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
  assert.match(html, /import init, \{ start, command, import_browser_files, restore_browser_backup_file \}/);
  assert.match(html, /mountMobileStudio\(\{ command, importBrowserFiles: import_browser_files, restoreBrowserBackupFile: restore_browser_backup_file \}\)/);
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
  assert.match(css, /#lightcraft_viewport\s*\{/);
  assert.match(html, /id="lightcraft_viewport"/);
  assert.match(html, /id="zoom_in"/);
  assert.match(html, /id="zoom_out"/);
  assert.match(css, /touch-action: none/);
  assert.match(css, /@media \(max-height: 620px\)/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="files_picker"/);
  assert.match(html, /id="panel_toggle"/);
  assert.match(html, /id="storage_status"/);
  assert.match(html, /id="backup_library"/);
  assert.match(html, /id="share_backup"/);
  assert.match(html, /id="download_backup"/);
  assert.match(html, /id="restore_backup_picker"/);
  assert.match(html, /id="backup_ready"/);
});

test("prototype does not contain a second fake image editing pipeline", () => {
  const js = readFileSync(new URL("../apps/lightcraft-web/mobile-lab.mjs", import.meta.url), "utf8");
  assert.match(js, /call\("develop\.set"/);
  assert.match(js, /call\("develop\.beginInteraction"/);
  assert.match(js, /createLatestValueScheduler/);
  assert.match(js, /mountPhotoGestures/);
  assert.doesNotMatch(js, /setTimeout\(\(\) =>\s*\{\s*delayed/);
  assert.match(js, /call\("develop\.endInteraction"/);
  assert.match(js, /call\("library\.select"/);
  assert.match(js, /call\("develop\.controls"/);
  assert.match(js, /call\("presets\.list"/);
  assert.match(js, /call\("preset\.apply"/);
  assert.match(js, /call\("preset\.favorite"/);
  assert.match(js, /storage\.persist\(\)/);
  assert.match(js, /storage\.estimate\(\)/);
  assert.match(js, /call\("file\.backupLibrary"\)/);
  assert.match(savedUI, /call\("app\.export"/);
  assert.match(js, /savedPhotosUI\.savePhoto\(\)/);
  assert.doesNotMatch(js, /call\("dialog\.export"/);
  assert.doesNotMatch(js, /getImageData|putImageData|ctx\.filter|canvas\.toDataURL|fetch\(["']https?:/);
});

test("PWA prepares a full Rust ZIP but requires separate user Save to Files action", () => {
  const js = readFileSync(new URL("../apps/lightcraft-web/mobile-lab.mjs", import.meta.url), "utf8");
  assert.match(js, /globalThis\.lightcraftReceiveBackup/);
  assert.match(js, /backupHandoff\.sharePrepared\(\)/);
  assert.match(js, /backupHandoff\.downloadPrepared\(\)/);
  assert.match(js, /restoreBrowserBackupFile\(file\)/);
  assert.match(rust, /pub fn restore_browser_backup_file\(file: web_sys::File\)/);
  assert.match(rust, /safety::restore\(file, backend\)\.await/);
  assert.match(safety, /fn deliver_backup\(name: &str, blob: &web_sys::Blob\)/);
  assert.match(safety, /deliver_backup\(&format!/);
  assert.match(build, /"backup-files\.mjs"/);
  assert.match(build, /"mobile-performance\.mjs"/);
  assert.match(build, /"mobile-gestures\.mjs"/);
  assert.match(sw, /"\.\/mobile-gestures\.mjs"/);
  assert.match(rust, /"web\.viewport"/);
  assert.match(sw, /"\.\/backup-files\.mjs"/);
  assert.match(css, /\.backup-ready\[hidden\]/);
});

test("landscape iPhone and iPad use a side-by-side photo and inspector", () => {
  const browserTest = readFileSync(new URL("./mobile-lab.browser.mjs", import.meta.url), "utf8");
  assert.match(css, /@media \(orientation: landscape\) and \(min-width: 560px\)/);
  assert.match(css, /--inspector-width: clamp\(230px, 38vw, 500px\)/);
  assert.match(css, /#lightcraft_viewport\s*\{\s*left: var\(--safe-left\);\s*right: calc\(var\(--inspector-width\)/);
  assert.match(css, /\.photo-footer\s*\{\s*left: var\(--safe-left\);\s*right: calc\(var\(--inspector-width\)/);
  assert.match(css, /\.category-tabs\s*\{\s*order: 1;/);
  assert.match(css, /\.console-heading\s*\{\s*order: 2;/);
  assert.match(css, /\.adjustment-scroller\s*\{\s*order: 3;/);
  assert.match(css, /:root\.studio-immersive \{ --inspector-width: 76px; \}/);
  assert.match(css, /@media \(orientation: landscape\) and \(min-width: 700px\) and \(max-height: 480px\)/);
  assert.match(browserTest, /name: "iphone-compact-landscape", split: true/);
  assert.match(browserTest, /name: "iphone-se-landscape", split: true/);
  assert.match(css, /max-width: 699px/);
  assert.match(css, /studio-immersive \.grabber-button::after/);
  assert.match(browserTest, /inspectorMin \?\? 280/);
  assert.match(browserTest, /name: "ipad-landscape", split: true/);
  assert.match(browserTest, /name: "ipad-portrait", split: false/);
});
