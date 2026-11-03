# LightCraft Local: mobile UX architecture and acceptance specification

**Status:** working implementation, milestone M2 (responsive workspace).  
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
