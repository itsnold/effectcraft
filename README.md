# EffectCraft for Android

**EffectCraft, made Android-compatible.** Create motion graphics, animate layers and keyframes,
apply effects, and composite media on your phone or tablet.

This is an **unofficial Android fork** of [EffectCraft](https://github.com/storytold/effectcraft)
by the ArtCraft Team. It bundles the Rust editor as WebAssembly inside a local Android WebView,
with Android file import/export and touch-adapted controls. It is not affiliated with or endorsed
by upstream.

**Android 0.2.3-alpha · EffectCraft v0.22.0 · Android 10+**

The next Android update is being prepared as **0.22.0-android.0.2.4-alpha**: the first part is
the upstream EffectCraft version; the suffix identifies this fork's Android alpha version. The
published download below stays on 0.2.3-alpha until the new build has passed release checks.

## Download and install

**[Android release and APK download](https://github.com/itsnold/effectcraft/releases/tag/android-v0.2.3-alpha)**

1. Open the release above and download **`EffectCraft-Android-0.2.3-alpha.apk`** from **Assets**.
2. Allow installation from your browser or file manager when Android asks, then install the APK.
3. Open **EffectCraft**. The editor is bundled in the APK; normal editing does not require a server
   or an internet connection.

The public APK is a **non-debuggable release build**, signed with this fork's permanent release
key—not an Actions debug/testing APK. This is a **public alpha**, not a claim of production-grade
reliability or support for every Android device. Release availability and validation are recorded
on the release page.

`SHA256SUMS.txt` accompanies the APK. Download only from this repository's release page. No GitHub
Actions ZIP, developer tools, or Play Store subscription is needed to install a published APK.

> **Coming from a testing build? Export your projects AND source media first.** Debug builds use a
> different signing key, so Android may require uninstalling the old app. Uninstalling erases its
> private projects, media and settings. Future public updates use the same release key.

## Android requirements

| Component | Requirement / guidance |
|---|---|
| Android version | **Android 10 / API 29 or newer**. Built with SDK 35 and targets Android 15. |
| Graphics | **OpenGL ES 3.0 / WebGL2** support. WebGPU is not required; adapter-dependent fallback is retained. |
| WebView | A recent **Android System WebView**, with WebAssembly and WebGL2 enabled. Chromium **120+ recommended**; keep your device's WebView provider updated. |
| CPU architecture | The editor is WebAssembly, with no ABI-specific native library bundled. Device compatibility still depends on its WebView and graphics driver. |
| Screen | Phones have portrait/landscape navigation and a compact timeline; tablets keep a docked workspace. A larger screen is more comfortable for specialist panels. |
| RAM / processor | **No measured minimum RAM or chipset requirement yet.** Heavy effects and large media can exhaust memory, even on recent phones. |
| Storage | Leave free space for the app, private copies of imported media, caches, and temporary export files. Keep external backups. |
| Network | The editor runs locally/offline after installation. Downloads, external Help links and optional online resources may need a connection. |

**Start with short 720p compositions and small media files.** This is practical starting advice,
not a performance guarantee. Smooth 4K playback, hardware video encoding and background rendering
are not promised.

## What you can do

- Build compositions with text, shapes, images, video, solids and nested compositions.
- Animate properties with keyframes and easing; use EffectCraft's 308 built-in effects and
  compositing tools.
- Browse the full File, Edit, Composition, Layer, Effect, Animation, View, Window and Help menus.
- Use phone-friendly selection actions, frame-accurate timing, **Box select**, **Trim** and Undo/Redo.
- Keep a live composition preview beside or above the phone timeline, resize it, or hide it.
- Swipe the shortcut bar for direct tools and modifiers—no extra **Tools** menu to open.
- Import through Android's system document picker; save projects and render outputs through the
  system **Create Document** picker.

The shared engine's feature set is broader than the Android device-testing matrix. Some dialogs
and specialist tools retain desktop-oriented layouts; not every upstream feature is Android-validated.

## Touch basics

| Gesture / control | Action |
|---|---|
| Tap | Select or activate a control. |
| Swipe in Auto mode | Scroll panels and the timeline without accidentally moving layers or keys. |
| Hold, then drag | Edit a layer/key or reorder a layer. |
| Long press without moving | Open the context menu where supported. |
| Pinch | Zoom the viewer or timeline, depending on the region. |
| **Trim** | Drag near either end of a layer bar without holding first. |
| **Box select** | Drag empty outline space for layers, or empty time space for keys. |
| Project / Effects | Hold an item or effect name, then drag it onto the live composition preview; a quick swipe scrolls. Use **Box select** from empty Project list space to select items. |
| **Actions** | Edit the selected layers/keys, including precision timing and easing. |
| **Done** | Leave a special editing mode. |
| **Back** | Dismiss an overlay/edit first; otherwise show the exit/save choice. |

See the [complete Android guide](docs/android.md) for gestures, layout overrides, file handling,
UI scale, builds and troubleshooting.

## Files, privacy and limitations

- Projects, imported media and preferences are stored privately on-device. **Save `.ecproj` files
  and their source media externally**; private storage and recovery are not a backup.
- Android can stop the app in the background. Keep the app open during rendering/export; process-death
  recovery is best effort, not guaranteed.
- The native export bridge currently allows **512 MiB per exported file**. Large projects, software
  codecs and complex effects may be slow or run out of memory before that limit.
- This is a WebView/WASM editor, not a native Android hardware-codec pipeline. Practical memory
  limits are device-dependent and below WebAssembly's address-space ceiling.
- No analytics or remote editing server is added. The Android shell blocks remote subresources and
  opens explicit external links in your browser. Licences are bundled with the app.

## Development and bug reports

- **[Report an Android issue](https://github.com/itsnold/effectcraft/issues)** with your device model,
  Android version, WebView version, app version and steps to reproduce. Do not attach private media
  or projects without reviewing their contents.
- [Build from source](docs/android.md#build-from-source): Rust 1.95+, WebAssembly tooling, Java 17,
  Gradle 8.13 and Android SDK 35. The Android project is under `packaging/android/`.
- [Android build workflow](https://github.com/itsnold/effectcraft/actions/workflows/android.yml):
  browser/touch regressions, JVM tests, Android lint, APK checks and the full Rust quality gate.
- [Release signing and acceptance checklist](docs/android-release.md).
- [Upstream engine documentation and desktop downloads](https://github.com/storytold/effectcraft/tree/v0.22.0).

The active Android source and this README live on the **`android`** branch. Development debug APKs
remain separate from the signed public APKs under Releases.

## Licence and credits

Based on **EffectCraft by the ArtCraft Team and contributors**. The Android compatibility work
is maintained in this fork; it is not an official ArtCraft Android release.

Code is dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
Copyright and required notices are preserved in [NOTICE](NOTICE). Fonts, icons and other assets
retain their own licences and credits in [ATTRIBUTION.md](ATTRIBUTION.md).
Restricted upstream trademark artwork is not included in this modified version.
