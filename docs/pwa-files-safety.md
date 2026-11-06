# LightCraft iOS PWA — local storage and copies in Files

LightCraft is a **PWA**: Safari → Share → Add to Home Screen → **Open as Web App**.
No Mac, Xcode, app signing, account, or cloud library is required.

## Where the photographs are kept

The running LightCraft library uses the original Rust/WebAssembly editor with
**OPFS (Origin Private File System)** or **IndexedDB** on the iPhone. Original
photographs and their edit journal are stored locally in that app's WebKit
storage. No photographs are uploaded to a LightCraft server.

A Home Screen web app has an isolated website-data store, separate from a
normal Safari tab. It is still website storage: uninstalling the Home Screen
app, deliberately removing its website data, device failure, or storage
eviction can delete that working library. Calling
`navigator.storage.persist()` does **not** protect against user deletion.

**Clearing Safari website data is not a supported test of data durability.**
Apple documents Home Screen storage isolation, but iOS does not give PWAs a
permanent Files directory or a guarantee about all data-clearing operations.

## Keep independent copies, the same way PlantIt does

1. In LightCraft, open **Photo library**.
2. Tap **Prepare complete library backup**. The Rust engine packages its
   catalog, settings, non-destructive edits, and imported original photographs
   into a verified-backup-format ZIP. At this point the ZIP is **only in memory**.
3. Tap **Share / Save to Files**. In the iOS share sheet, choose **Save to
   Files → On My iPhone**, select a folder and confirm **Save**.
4. Open the iPhone **Files** app and confirm the
   `lightcraft-library-backup-YYYY-MM-DD.zip` exists and has a realistic size.
   This independent file is *not* affected by clearing the PWA's website data.
5. If your browser does not support ZIP file sharing, use **Download backup
   ZIP** instead, then locate the file in **Files → Downloads** and move/copy
   it to **On My iPhone**. Confirm that saved file.

The app cannot automatically write outside the WebKit sandbox into an arbitrary
iOS Files folder; the user must select **Save to Files** or export the file.
Do not treat a staged backup, a share-sheet launch, or a notification as proof
that a file has actually been saved.

### Restore after reinstalling or clearing app data

1. Open LightCraft from its Home Screen icon.
2. Tap **Photo library → Restore complete library from ZIP**.
3. Choose the `.zip` saved in Files. The Rust restore validates the archive
   structure, integrity checks and original content hashes.
4. Only after all files are accepted does LightCraft switch to the restored
   library folder and reload. Failed restores do not replace the active catalog.
5. Open multiple photos and check their edits before discarding other backups.

The backup is a **plain ZIP, not password-encrypted**. Unlike PlantIt's
encrypted `.plantit` snapshots, anyone who can access this ZIP can inspect
your photos. Keep it in a private folder.

## Important limitations

- Backups are **manual snapshots**, not continuous autosaves outside WebKit.
  Prepare a new backup after importing or editing important photos.
- ZIP creation needs memory. Very large RAW libraries may require smaller
  batches or a future streamed backup implementation; verify on the actual
  iPhone before relying on the feature.
- Safari may not offer ZIP in the Web Share API. The downloadable backup route
  remains available in that case.
- Saving to **On My iPhone** keeps a local copy. Saving to **iCloud Drive**
  syncs that file with Apple and is not strictly device-only.
- Neither the PWA nor the separate ZIP protects against losing the phone;
  keep an additional copy on another device if the library matters.
- The original Rust editor handles image processing; Files backup never
  replaces it with an invented editor or cloud service.

For technical context:
- WebKit Home Screen storage isolation:
  https://webkit.org/blog/14787/webkit-features-in-safari-17-2/
- WebKit storage quotas and eviction:
  https://webkit.org/blog/14403/updates-to-storage-policy/
- Safari share API user-activation behavior:
  https://webkit.org/blog/13862/the-user-activation-api/
