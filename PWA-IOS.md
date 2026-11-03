# LightCraft Local — installable iOS / iPadOS PWA

This fork keeps the original Rust / WebAssembly LightCraft editor and adds
an installable, offline-capable web application shell for GitHub Pages.

## Deployment

The `.github/workflows/lightcraft-pages.yml` workflow builds the original
editor with `cargo xtask web` and deploys its generated `target/web-site`
directory as static files. After merging the branch to `main`:

1. Open the fork's **Settings → Pages**.
2. Set **Build and deployment → Source → GitHub Actions**.
3. Run **Actions → LightCraft Local — GitHub Pages → Run workflow**, if a
   push to `main` did not already initiate the workflow.
4. Open the Pages URL from the workflow's successful deployment job.

Expected project-site URL:
`https://hambonesoftware.github.io/lightcraft-iOS-pwa/`

The deployer uses a commit-specific service-worker cache. Existing open
sessions retain their previously installed JS/WASM version until the active
worker can be replaced; close all Home Screen and browser windows and reopen
to pick up a new version.

## Install on iPhone or iPad

1. Open the Pages URL in **Safari** while online.
2. Use **Share → Add to Home Screen**.
3. Launch **LightCraft Local** from the Home Screen.
4. Import a small photo, make an adjustment, and reopen the PWA to verify
   its catalog persists before trusting it with larger libraries.
5. Once the PWA's first service-worker install completes, its core editor
   files should be available without internet access.

LightCraft currently uses WebGL2; devices without it cannot run the editor.
The original desktop-oriented egui interface may still need touch-specific
interaction refinements. Browser behavior and offline reliability should be
tested on physical iOS hardware.

## Where photos are stored

LightCraft **already** saves its catalog, imported originals, thumbnails,
preferences, and edit settings in private per-origin browser storage:
OPFS where available, otherwise IndexedDB. The new service worker only stores
the editor's static application assets. It does not hold your original photos
and does not upload them to GitHub Pages.

Use **File → Back Up Library…** frequently, especially before upgrades or
major imports, and save the resulting archive in the **Files** app or another
durable location. **File → Restore Library from Backup…** restores a
compatible archive in the existing app. The upstream format currently
supports archives up to 4 GB. Backups and exports require user interaction
on iOS; a PWA cannot silently manage arbitrary Files-app folders.

**Important:** iOS can discard site data under some conditions and deleting
the Home Screen app may destroy its private library. Clearing site data,
changing hostnames, or switching between Safari and a Home Screen PWA can
also change which storage area is used. Keep original copies elsewhere.
Do not interpret installation or `navigator.storage.persist()` as a
guarantee that data cannot be removed.

## Technical notes

- All page, manifest, icon, WASM, JavaScript, and service-worker paths are
  relative, so the app works under a GitHub Pages project prefix.
- The source includes no analytics, remote backup, account login or server
  sync; GitHub Pages is used solely for static code delivery.
- The service worker precaches the full WASM module, glue JS, render worker,
  page, manifest, and icons. Optional CJK font assets are not precached.
- The current editor uses non-shared Web Workers, so GitHub Pages does not
  need cross-origin isolation response headers for the present build.
- Mobile memory limits, raw decode support, touch accuracy and iOS file
  download behavior require hands-on tests before promising production
  durability.

## Build locally

```sh
rustup target add wasm32-unknown-unknown
# Install the version of wasm-bindgen-cli pinned in Cargo.lock.
cargo xtask web
python3 -m http.server 8765 --directory target/web-site
```

Visit `http://localhost:8765/`. The source's `__BUILD_SHA__` service-worker
cache token is replaced by the deployment workflow, but a local test can use
the literal token.

The original project remains licensed under MIT OR Apache-2.0; preserve its
license and attribution requirements. This fork is not an official release
of the original project.
