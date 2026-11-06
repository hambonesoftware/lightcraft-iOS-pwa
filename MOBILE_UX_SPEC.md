## Follow-up: iPhone screenshot showed Looks still blank

The November 5 follow-up screenshot showed the Photos loupe severely zoomed with a Navigator overlay, while the newly styled Looks inspector displayed only its title, Expand and Done in the vertical middle of an otherwise blank panel.

**Root cause confirmed from the actual forked egui source:** `ui.horizontal_centered` calls `allocate_ui_with_layout_dyn` with `available_size_before_wrap()`, allocating the full available panel height. Using it for the first row of an inspector creates a full-height row, vertically centers the title, and pushes subsequent group and preset thumbnail controls below the panel's clip rect.

**Correction:**
- Use `ui.horizontal`, which sizes to the actual row content rather than the full available vertical space, throughout the compact inspector and mobile Looks browser.
- Keep the unselected Looks inspector around 242 logical points and expand to 300 when a preset is selected, preserving the photo canvas.
- Fit the photo and recenter pan when opening Looks so stale desktop/gesture zoom doesn't hide most of the image.
- Suppress face boxes and the Navigator while evaluating Looks or develop corrections on mobile, restoring all persisted desktop settings after rendering.
- Add an egui render-layout regression test that asserts the inspector header and next gallery content remain near the top of a 260-point sheet, not halfway through it.

**Validation:** source/build tests do not substitute for screenshot-based iOS verification. Confirm visible group chips, preset tiles, strength/Apply/Cancel and whole-photo preview in Safari and installed Home Screen mode. Keep original photos and backups; never clear website data to refresh the app.

# LightCraft Local: mobile UX architecture and acceptance specification

**Status:** M2 responsive workspace plus a new correction-category and visual-preset implementation; physical iOS acceptance is still required.  
**Scope:** actual LightCraft Rust/egui WebAssembly editor, catalog, render engine and OPFS/IndexedDB library.  
**Goal:** make mobile editing feel intentionally designed for iPhone and narrow iPad windows without hiding or breaking professional tools.

## Product principles

1. **Photo first.** The active image is the main object. Drawers never become mandatory chrome.
2. **Progressive disclosure.** Library, Edit, Crop, Mask and More are the primary destinations. Keep advanced LightCraft features in scrollable contextual tools, not in a 12-icon vertical strip.
3. **Preserve LightCraft.** Continue using the shared non-destructive develop pipeline, catalog, masks, presets, crop, render requests and exports. Do not duplicate or rewrite edits in HTML/JavaScript.
4. **A gesture must have an alternative.** Do not make press-and-hold, pinch, or double-tap the only way to reach an action. Provide explicit Before/After and Fit buttons.
5. **Avoid accidental keyboards.** Search is closed by default; its input is created only in the Library after choosing Search. Numeric entry stays intentional.
6. **Targets fit fingers.** Interactive controls aim for 44×44 pt or greater, with spacing around repeated actions. Mask pins and crop handles need subsequent validation on real devices.
7. **Respond to available space, not only user-agent.** Portrait and landscape phones, narrow Stage Manager windows and split views deserve compact controls. Large iPad windows retain the docked workspace.
8. **Respect the safe area, keyboard and dynamic viewport.** Status bar, home indicator, browser toolbar and software keyboard must not cover controls.
9. **Keep state and original files private.** Catalog/originals remain in the existing OPFS/IndexedDB storage. Browser clearing, eviction and uninstall still require explicit user-facing backup guidance.
10. **Preserve accessibility.** Text labels, VoiceOver-friendly controls, no forcibly disabled system zoom, clear contrast, and alternative actions when gestures are unavailable.

## Breakpoints and behavior

| Case | Available viewport | Workspace |
|---|---:|---|
| Narrow portrait window | width < 720 pt | Compact |
| Short landscape window | height < 510 pt and width < 1100 pt | Compact |
| Full-size iPad / desktop | otherwise | Existing docking interface |
| Fullscreen slideshow/preview | any | Existing fullscreen viewer |

These are **logical points**, not device pixels. This prevents treating all iPads alike and accommodates a resized desktop window.

## Primary screen states

### A. Library
- Primary image gallery: existing fast photo grid, not a new web-based library.
- Header: LightCraft, Search, Import.
- Bottom: Library / Edit / Crop / Mask / More.
- Search input appears **only** after deliberate Search. Done closes and surrenders its keyboard focus.
- Import invokes the same browser-native File import command as desktop.
- Selecting a photo opens existing Detail mode.
- More has backup and restore for local-data durability.

### B. Detail / viewing
- Header: Library/back, LightCraft, Export.
- Existing Rust/egui image viewport fills free space.
- Bottom navigation stays visible; tool drawer is initially closed.
- The desktop filmstrip is hidden **during compact rendering only**; its saved preference is restored immediately afterward.
- Existing pinch zoom and two-finger translation remain active through the native LightCraft loupe implementation.
- Switching back to Library must never leave an invisible mask/crop overlay active.

### C. Quick editing
- Tapping Edit, Crop or Mask opens one contextual bottom drawer with the **existing** tool panel.
- Drawer title, Fit, Before/After, Expand and Done are available.
- A second tap on an active tool closes the drawer.
- Drawer stays independently scrollable, preserving existing curves, color, masking and crop controls.
- Expanded drawer increases area for precision controls; collapse returns image space.

### D. Advanced
- More exposes Presets, Remove, Info, Versions, History, Import, Export, library backup and restore.
- These commands use existing app actions; no server-side service or data conversion is introduced.
- Full iPad/desktop docking remains unchanged.

## Existing feature mapping

| Existing feature | Compact location | Implementation |
|---|---|---|
| Photo grid and source catalog | Library | Existing grid renderer |
| Import from Files/Photos picker | Header Import; More | file.addPhotos |
| Search and filter | Library > Search | library.filter |
| Non-destructive develop sliders | Edit drawer | Existing RightPanel::Edit |
| RAW engine, pipeline and presets | Edit; More > Presets | Existing rendering/develop/presets |
| Crop/rotate/geometry | Crop drawer | Existing RightPanel::Crop |
| Masks, brush and gradients | Mask drawer | Existing RightPanel::Masking |
| Remove/heal | More > Remove | Existing RightPanel::Remove |
| Metadata / history / versions | More | Existing panels |
| Photo zoom and pan | Image gestures + Fit | Existing loupe; Zoom::Fit |
| Before/After | Editing drawer control | view.beforeAfter |
| Export to iOS file download | Header Export; More | dialog.export |
| Local library backup / restore | More | Existing backup commands |
| Compare, Survey, Reference, People | Existing underlying state | Render retained; menu exposure and touch usability are follow-up work |

## Lightroom-style correction and filter update

- Mobile editing navigation is horizontally scrollable; Library stays pinned while Presets, Light, Color, Effects, Detail, Optics, Calibrate, Crop, Mask and More can be reached with a swipe.
- Light, Color, Effects, Detail, Optics and Calibration render their actual existing Rust develop controls as individual categories, without changing the desktop fold or order.
- Light exposes one-tap Auto; photo Fit and Before/After remain accessible above corrections.
- The mobile presets view uses a two-column gallery with real photo-specific variant renders rather than a mouse-hover-only list.
- A tap **previews only**: the original catalog and edit history are unchanged until **Apply Look**. The strength slider previews 0–200%, and Cancel discards it. Presets are still grouped with Favorites first.
- Only thumbnails in the visible gallery rows are requested, helping avoid an unbounded memory load on mobile.
- Desktop uses the original preset browser and existing develop panel unchanged.

### Remaining device validation

Check low-memory iPhone photo editing and scrolling performance; portrait and landscape tool reachability; accurate preset thumbnail/large-image preview parity; switching photos during an uncommitted look; and output export matching the applied look. Fine-tuning the lower-level slider touch handling, mask handles, and iOS keyboard remains a separate quality pass.

## Mobile inspector redesign: screenshot-led usability correction

### Why this exists

The November 5 iPhone screenshot showed the old Presets inspector as a large blank gray panel with the actual controls clipped at the top edge, oversized rectangular navigation buttons, and a photograph separated from its adjustment controls. This is a **layout correctness defect**, not a missing preset-processing feature.

### Architectural change

- Replace stacked/nested top, bottom and central egui panels on compact screens with explicit, nonoverlapping rectangles derived from the actual available viewport.
- Give the photo canvas, bottom navigation, inspector and header independent clipping boundaries.
- Draw the Looks inspector before the photo canvas so a selected look can preview in the actual loupe on the same UI pass.
- Keep phone-safe minimum canvas height, including when a preset selection reveals its intensity slider and Apply/Cancel controls.
- Provide a compact, labeled icon rail with scrollable correction destinations and a restrained selected indicator instead of full-size desktop buttons.
- Retain the original desktop workspace unchanged.

### Looks / Presets interaction

- Group chips select Favorites and existing preset groups.
- A horizontal visual strip shows photo-specific thumbnails; avoid a full desktop-style vertical preset catalog inside a small bottom inspector.
- A page contains at most 12 presets; the Prev/Next buttons reach additional pages of larger imported preset groups without overwhelming mobile WebKit.
- Selecting a thumbnail shows a reversible, uncommitted live preview of the photo.
- Strength and explicit Apply/Cancel appear only when a look is selected; the inspector grows to accommodate them.
- Leaving Looks or closing the inspector discards an uncommitted preview.
- All actual rendering and commits go through LightCraft's existing variant renderer and `preset.apply` command.

### Regression checks

The viewport geometry tests cover small iPhone landscape, portrait and taller windows and ensure the photo and inspector do not overlap, that the bottom dock remains inside the viewport, and that a look preview grants extra inspector space.

**Physical-device release gates:** On iPhone portrait and landscape, ensure no blank inspector area, fully visible group chips and images, properly reachable Apply/Cancel actions, correct photo preview, a responsive photo canvas, and no automatic keyboard. Repeat after returning from Files import/export and after switching presets.

## Interaction test matrix

### Functional (automated)
- Compact breakpoint for 393×852, 852×393 and narrow iPad windows.
- Full dock for 1024×768 and 1440×900.
- Editing drawer reserves at least 100 pt for the photo canvas.
- No automatic Search field in mobile default view; desktop field focus is surrendered without interrupting explicit mobile search or numeric text entry.
- Mobile tabs never replace the source photos, catalog, or undo history.
- Import, export, backup and restore retain original command names and pass through app.run.
- Screen transitions do not leave Crop and Mask panels active invisibly.
- PWA original/cache separation remains tested in tests/pwa.test.mjs.

### Physical iOS/iPadOS release gates (not automatable in the GitHub cloud)
1. iPhone portrait: inspect top bar, Home indicator, toolbar, grid, editing drawer and keyboard.
2. iPhone landscape: confirm compact mode and readable controls.
3. iPad full window and Stage Manager narrow window: verify switch between docking and compact modes.
4. Import JPEG/PNG and camera RAW where supported; inspect image orientation and slider edits.
5. Tap Edit, change exposure, toggle Before/After, Fit, Export to Files.
6. Compare reopen behavior after switching apps, force-closing and launching offline.
7. Back up library to Files and restore into a separate test library; verify original photos and adjustments.
8. Confirm large photos and repeated masks do not cause a page refresh under WebKit memory pressure.
9. Test VoiceOver, larger text, external keyboard and touch targets.
10. Upgrade a deployed release with stored photos; verify no JS/WASM mismatch and no lost library.

## Milestones

- **M1 — Design system and feature inventory:** this specification; baseline screenshot and code audit.
- **M2 — Responsive shell:** native Rust/egui compact header, view selection, contextual bottom drawers and hidden desktop chrome on narrow screens. Implemented on a feature branch.
- **M3 — Precision gestures and editor controls:** validate/edit pinch center anchoring, two-finger pan, double-tap Fit and long-press Before; improve touch handles/slider hit regions with keyboard fallback.
- **M4 — Library & advanced UX:** refined mobile grid, organization, numeric-entry sheets, accessible masking UI, complete navigation of all desktop feature families.
- **M5 — Performance and device regression:** device-based layout verification, safe-area and keyboard fixes, memory profiling, offline and persistence validation.

M2 is a first functional shell, not a declaration that the entire app has finished the M5 acceptance suite. Do not call it fully iOS-certified without the physical-device tests.

## Comparative reference patterns

Design direction: Apple Photos' content priority; Adobe Lightroom Mobile's clearly grouped develop tools; Darkroom's contextual and gesture-driven editing. These are interaction patterns, not artwork or proprietary source code to copy. Apple's Human Interface Guidelines inform touch targets, adaptive layout, discoverability, and accessibility.

References: [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/), [Lightroom Mobile](https://helpx.adobe.com/lightroom-cc/using/lightroom-mobile.html), [Darkroom](https://darkroom.co/).

## File architecture

- crates/ui-egui/src/panels/mobile.rs — compact navigation and contextual tool layout.
- crates/ui-egui/src/app/frame.rs — route narrow views to the compact workspace.
- crates/ui-egui/src/panels.rs — register mobile panel.
- apps/lightcraft-web/index.html — PWA safe areas, viewport and text input behavior.
- tests/pwa.test.mjs — service-worker privacy/offline checks.
- MOBILE_UX_SPEC.md — requirements and release gates.
