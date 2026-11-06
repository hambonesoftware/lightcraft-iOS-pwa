# Mobile Studio: architecture audit and opt-in proof of concept

Status: Experimental. The standard index.html interface is unchanged. Do not make this the default Home Screen route until tested on an actual iPhone.

## Architectural conclusion

LightCraft already separates most editing functionality from the desktop egui interface:

- crates/engine/src/lib.rs: Session::execute is the stable, journaled command dispatcher used by all front ends.
- crates/engine/src/cmd/query.rs: develop.controls returns labels, ids, ranges, precisions and live values. Library and photo queries are independent of desktop panels.
- crates/develop/src/controls.rs: a reusable typed develop control specification.
- crates/pipeline/src/lib.rs: Rust image processing is decoupled from desktop controls.
- apps/lightcraft-web/src/web.rs: the existing wasm-bindgen command(id, params) bridge can run the actual editing commands.
- apps/lightcraft-web/src/backend.rs, store.rs and files.rs: original photo storage and catalog persistence via OPFS/IndexedDB.
- crates/ui-egui/src/panels/detail.rs: the existing renderer and photo viewer support real photos, adjustments, zoom and masking.

Conclusion: We can create HTML/CSS controls that use the same engine and local library without implementing an inferior second editor. The long-term challenge is separating presentation, canvas gestures and pixel output from egui; mathematical corrections are already independent.

## Why the previous mobile interface failed

Nested egui panels reused desktop control layouts in a narrow viewport. In its fork of egui, horizontal_centered reserves the full available inspector height, pushing preset content below the clip rectangle. Desktop zoom and face overlays also carried over. Passing compilation did not verify the actual rendered layout on iOS.

## Implemented isolated route

After building this branch, open /mobile-lab.html. This page is NOT the default install URL; it loads the SAME LightCraft WASM and origin-private library as /index.html.

Only on this route, WebApp temporarily enables the real fullscreen egui photo viewer during its UI pass and restores the previous view preferences before saving. The browser lays out a compact header, fitted photo canvas, correction sheet and horizontal category tabs.

Real commands are used:
- Light, Color, Effects, Detail and Optics controls: develop.controls.
- Slider begin/update/end: develop.beginInteraction, develop.set and develop.endInteraction, preserving one undo interaction.
- Browse and select photos: catalog.query, library.state, library.select.
- Undo/redo: edit.undo, edit.redo.
- Auto: develop.auto.
- Photo Fit: view.zoomFit.
- Compare: view.beforeAfter.
- Export: dialog.export.
- Import: native HTML file picker calls import_browser_files during a real user input change; bytes pass through the existing Rust store_file and Originals queue.

No CSS photo filters, fake editing canvas, remote image backend, parallel catalog, or second storage implementation is introduced.

The first slice deliberately covers a single focused photo editor workflow, not the entire desktop feature surface. The library browser is filenames plus real metadata, not a complete thumbnail gallery. Existing advanced presets/masks/crop remain available in the original editor. DOM thumbnails and native export dialogs would be later bridge features, requiring careful rendering and user-activation integration.

## Risk register

1. The viewer still paints with egui; future pure web rendering needs a safe texture or pixel bridge.
2. Crop/brush/masking gesture ownership must be defined before porting those controls to the DOM.
3. Imported files use the original OPFS/IndexedDB catalog. Do not clear website data; keep original files and independent library backups.
4. Memory pressure under 32-bit iOS WebAssembly and large RAW files needs physical hardware tests.
5. Export currently invokes the original egui export dialog and must be verified with Files on iOS.
6. A native HTML slider should use begin/endInteraction for a single undo record. Test pointer cancellation and keyboard slider use.
7. WebKit PWA service worker upgrades and standalone storage scope require device validation.
8. Mobile Studio uses the same origin and saved edits, with no automatic migration or forked photo library.
9. The standalone visual shell has no external libraries or telemetry.
10. The service worker now caches the lab assets with the versioned WebAssembly module; offline relaunch remains unverified.

## Acceptance gates

- Node tests for control mapping, numeric formatting, markup, privacy and the build artifact.
- Rust formatting, Clippy, tests and complete WebAssembly compilation.
- Verify both / and /mobile-lab.html load, independently, on GitHub Pages.
- On physical iPhone: import JPEG, select image, adjust exposure, compare, undo, redo, export and relaunch, checking the actual output image.
- Confirm native sliders are responsive without stealing pinch/pan from the photograph.
- Compare final exported pixels and edits with the original desktop interface.
- Validate large photos, landscape, iPad split view, accessibility and failed import handling.
- Add real photo thumbnail bridge, advanced preset gallery, masks and crop in subsequent milestones.
- Only consider changing the default app after the native controls succeed on an actual device.

This implementation is a feasibility prototype, not a declaration that LightCraft's complete UI has been rewritten.
