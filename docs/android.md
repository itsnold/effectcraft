# ECDroid for Android (alpha)

ECDroid is an **unofficial fork**, based on EffectCraft by the ArtCraft Team. The Android shell
packages the Rust/WebAssembly editor from this checkout; no remote website, account, server,
FFmpeg or proprietary editor code is required. The Java shell only supplies Android platform
services; the editing engine and codecs are unchanged Rust.

## Requirements and installation

- Android 10 (API 29) or newer, OpenGL ES 3, and a recent **Android System WebView** (Chromium 120+
  recommended; update it through the Play Store). WebAssembly and WebGL2 must be enabled.
- A tablet or landscape phone is recommended. Start with short, small projects (e.g. 720p).
- In this fork's **Actions → Android APK**, select a successful run and download the `ecdroid-debug`
  artifact. Unzip it and install `app-debug.apk`, allowing installation from that source if asked.
  This is a sideloadable **debug-signed testing APK**, not a Play Store production release.
- The workflow also includes `SHA256SUMS.txt`. A fresh CI debug key may require uninstalling an
  older testing APK before installing another: **export projects first**, since uninstalling erases
  the app's private session/media storage. Never rely on it as your only copy.

## Touch controls

| Input | Action |
|---|---|
| Tap | Left click / selection |
| One-finger drag | Move, scrub, resize panels, trim layers, adjust values |
| Hold still for 500 ms | Right-click context menu; no initial left click |
| Two-finger pinch | Zoom timeline time scale or composition around the gesture |
| Two fingers moving together | Scroll panels / timeline (not a layer drag) |
| Hand + drag | Pan composition |
| Shift toggle + tap/drag | Multi-select / constrained editing |
| Alt / Ctrl toggles | Modified gestures otherwise needing a keyboard |
| Viewer / Timeline buttons | Maximize / restore that panel |
| Fit | Fit composition and reset pan |

The bottom shortcut bar scrolls horizontally and has 48 × 44 CSS-pixel minimum buttons: Undo,
Redo, Play, Save, Import, Select, Hand, Fit, modifier toggles, panel expansion and Help.
**Settings → Appearance → UI Scale** enlarges the editor's existing controls (75–200%). Most
underlying panels still use their desktop layout; a bigger bar does not make every handle finger-sized.
The first Android launch sets UI Scale to 125% and layer, footage and preview caches to 128 MiB each.
Later settings changes are preserved; these limits do not bound codec or worker memory.
Mouse and pen input are not remapped. Lifting one finger after a pinch cannot become an accidental
click. Adding a second finger during an already-started drag ends that drag; it does not undo it.

## Files, privacy and recovery

- **Import / File → Open** uses Android's system document picker, including multiple selection.
  No all-files or gallery permission is requested. Files are copied into the editor's private store.
- **Save** and completed Render Queue jobs open **Create Document** so you choose where to put the
  project/video/image/ZIP. WebView cannot save blob URLs through DownloadManager, so the shell copies
  them in 192 KiB chunks to a temporary file, then streams it to the selected document URI.
- Export bridge limits: 512 MiB per file; four queued native exports. Oversized/incomplete transfers,
  failed writes and cancelled saves show an error/retry choice instead of silently succeeding.
  Retried exports keep their bytes while the app stays open. Render outputs are not crash-persisted.
- Projects, imported media and settings use the existing OPFS / IndexedDB store. Session recovery
  and autosave are best effort. Save an `.ecproj` and keep its source media outside app storage.
  Android can kill background apps without a shutdown callback. Back offers to save/flush before exit.
- Assets load over an intercepted app-private HTTPS origin, not `file://`. Remote subresources and
  in-WebView navigation are blocked. Explicit Help links open in an external browser. The native
  bridge is never exposed to remote pages. No analytics or remote server is added.
- Licences and notices ship in the APK assets under `editor/licenses/`.

## Build from source

Use a Linux/macOS/Windows development machine with Rust ≥1.95, the `wasm32-unknown-unknown` target,
wasm-bindgen CLI **0.2.129**, Java 17, Gradle **8.13**, Android SDK platform 35 and build-tools 35.0.0.
The Gradle project deliberately lives under `packaging/`, outside Cargo's `apps/*` workspace glob.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
node apps/effectcraft-web/tests/touch.mjs
cargo xtask ci
cargo xtask web
gradle -p packaging/android :app:testDebugUnitTest :app:assembleDebug
# packaging/android/app/build/outputs/apk/debug/app-debug.apk
```

Set `ANDROID_HOME` / `ANDROID_SDK_ROOT` or `packaging/android/local.properties` as usual. For a
non-default Cargo target directory, supply `-PwebDist=/absolute/path/to/web/dist` to Gradle.
Missing WASM is a build error, never an empty shell. The APK contains the complete static build
including workers, fonts and licences. No native ABI library is needed: the same APK works on
ARM64 and x86_64 devices with a compatible WebView.

GitHub Actions builds from source on `android` pushes and manual dispatch. It runs the full upstream
Rust gate separately, Node gesture/browser-host tests, JVM export tests, the WASM build, Android lint
and APK assembly. A headless browser test checks the Android-mode UI. It uploads the testing APK
and checksum only after that job's checks pass. The separate Rust gate can expose existing upstream
failures; inspect **both** jobs before distributing an artifact.

## Known limitations / what is not promised

- This is a WebView/WASM port, **not** a native Android NDK port or a CapCut Pad clone. No Android
  hardware video encoder/decoder integration, background rendering service or fully adaptive phone
  workspace has been added. Desktop engine limitations still apply.
- Android WebView WebGPU support varies, so WebGL2/CPU fallback must be usable. One CPU frame worker
  is requested instead of the desktop's two GPU workers, reducing memory/driver pressure. Heavy
  effects, large media, frame caches and software codecs can still exhaust memory or be very slow.
  WASM has a 4 GiB address-space ceiling and practical phone limits are lower.
- No shared-memory Rust threads. The UI, frame worker and export worker each have their own engine
  memory. No claim of smooth 4K playback/export on a phone.
- Folder picking via the desktop File System Access API is generally unavailable; use Import or
  Media Browser → Add Files. Custom filesystem paths are virtual names, not Android shared paths.
- A compiled APK and desktop Chromium touch tests do **not** establish on-device usability. Device
  testing is still required: launch offline, import, text/IME, long press, drag, pinch, rotate, audio,
  save/reopen, MP4/GIF export, document-provider failure, background/process death and recovery.

## Public interface research (behaviour only)

The references support tablet workspace design, not an assertion that CapCut uses our exact gestures:

- [CapCut Pad announcement, 16 Dec 2025](https://www.prnewswire.com/news-releases/introducing-capcut-pad--a-new-editing-experience-designed-for-ipad-creators-302643707.html):
  rebuilt large-screen workspace, touch/pen input and multi-track editing.
- [CapCut's Pad page](https://www.capcut.com/tools/capcut-for-ipad): timeline clarity, layers and
  touch-oriented keyframe controls.
- [CapCut iPad precision guidance](https://www.capcut.com/help/can-not-select-functions-on-ipad):
  small controls and gesture conflicts are real problems; a scaled desktop UI alone is not enough.

This port uses generic touch conventions and original code, without reading or copying a proprietary
app's implementation or bundling its assets. Upstream restricted trademark artwork is removed.
