# LightCraft Local for iOS — native Documents storage

This is an **installed iPhone/iPad application**, not the Add to Home Screen
version of a website. The UI is the touch-first Mobile Studio, with ArtCraft
LightCraft's existing Rust/WebAssembly processing and non-destructive catalog.

The native build writes all **original photos, catalog files, edit journals,
thumbnail index, exported images, and backups** beneath the iOS application
Documents directory using `@capacitor/filesystem`:

```text
On My iPhone
└── LightCraft Local
    └── LightCraft
        ├── originals/
        ├── library/
        ├── thumbs/
        ├── exports/
        └── backups/
```

The folder visibility depends on the iOS Files app and the two sharing keys
configured in Info.plist. The library can also use a restored catalog folder.
**None of these user-generated files are written to IndexedDB or OPFS by the
native app.** Browser storage continues to serve only the separately hosted PWA.

## Build and install on an iPhone

Requires macOS, Xcode 26, Node.js, a Rust compiler, a recent Apple developer
toolchain, a connected or otherwise provisioned iPhone, and an Apple signing
team (free or paid, depending on your distribution plan).

From the repository root:

```bash
rustup target add wasm32-unknown-unknown
VERSION="$(awk '$0 == "name = \"wasm-bindgen\"" { getline; gsub(/version = |"/, ""); print; exit }' Cargo.lock)"
cargo install wasm-bindgen-cli --version "$VERSION" --locked
cargo xtask web
cd native/ios-app
npm install
npm run bundle
npx cap add ios
npm run sync:ios
npx cap open ios
```

In Xcode open the **App** scheme, select your signing team and iPhone,
configure the bundle identifier if needed, then Build and Run. To rebuild after
source updates, rerun `cargo xtask web` from the repository root and then
`npm run sync:ios` in this directory. Do not rerun `npx cap add ios` once
the Xcode project exists.

The native web payload is bundled in the app by Capacitor; there is no
`server.url` pointing to GitHub Pages. The startup file imports
`native-storage.js`, checks native Documents read/write, and **does not allow
the Rust backend to fall back to OPFS/IndexedDB** if the native bridge fails.
Render workers are disabled for the native host because Capacitor native
plugins cannot be invoked from dedicated Web Workers.

The Xcode project is generated locally by Capacitor rather than checked in.
`npm run sync:ios` also configures Files visibility and adds the FileTimestamp
privacy declaration required by Capacitor Filesystem. This script needs
CocoaPods' `xcodeproj` Ruby library on the Mac.

## Moving a library from the old Home Screen PWA

The PWA and the native app use **different storage containers**; merely
installing the new app does not transfer previous photos. Do not delete the
old PWA before verifying a copy of your library.

1. Open the existing Home Screen or Safari LightCraft library.
2. Use **Photo library → Back up library to a file**. Save the resulting ZIP
   somewhere accessible in iOS Files (for example On My iPhone or iCloud Drive).
3. Install the new signed native LightCraft app.
4. Open **Photo library → Restore library from a backup**, choose that ZIP,
   approve the restore and allow the app to reload.
5. Open multiple imported photos and verify their originals, edits and export
   output before removing the old copy.

Native backups now save directly to `LightCraft/backups/` in the Documents
folder, and native rendered exports to `LightCraft/exports/`. Copy backups
off the device regularly. Uninstalling the native app can delete its Documents
folder. Neither a PWA nor an installed native app makes backups optional.

## Status and constraints

- The native backend uses Capacitor v8 and the official Filesystem plugin.
- The hosted GitHub Pages PWA is unchanged in its separate browser storage use.
- JavaScript passes image bytes through the native plugin as base64; large
  RAW imports and large ZIP backups need real-device memory/performance testing.
- Normal append-only catalog writes use `appendFile`; journal truncation
  uses read/modify/write, which is not a transactional replacement. Native
  application storage addresses browser eviction, not all write-failure risks.
- Native exports are asynchronous: wait for the **Saved** notification before
  exiting the app.
- GitHub Actions assembles the production WASM payload and compiles an
  unsigned iPhone Simulator build on macOS. Signing and actual-device testing
  still require an Apple environment.

Upstream LightCraft and its photo-processing engine are by ArtCraft and
contributors: https://github.com/storytold/lightcraft . This is an independent
mobile-first integration.
