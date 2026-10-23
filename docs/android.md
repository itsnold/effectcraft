# EffectCraft for Android (alpha)

This is an **unofficial Android fork**, based on EffectCraft by the ArtCraft Team. The Android shell
packages the Rust/WebAssembly editor from this checkout; no remote website, account, server,
FFmpeg or proprietary editor code is required. The Java shell only supplies Android platform
services; the editing engine and codecs are unchanged Rust.

## Requirements and installation

- Android port **0.1.5-alpha** includes upstream **EffectCraft v0.16.0**
  (`9581b53c3f8945683252af0eb5fac79e0e43aed4`). This update brings secure temporary cache
  filenames, service-worker cache-failure recovery and expression/ScriptUI reliability fixes.
  Upstream 0.15/0.16 added no new editing features beyond this fork's existing engine base.
  The phone workspace, touch/timeline controls, 4096-pixel WebGL fallback, package ID and
  project storage are preserved; the APK version code increases to 6.
- Android 10 (API 29) or newer, OpenGL ES 3, and a recent **Android System WebView** (Chromium 120+
  recommended; update it through the Play Store). WebAssembly and WebGL2 must be enabled.
- Phones get a compact, single-panel workspace in portrait and landscape; tablets keep the docked
  workspace. Start with short, small projects (e.g. 720p).
- In this fork's **Actions → Android APK**, select a successful run and download the `effectcraft-android-debug`
  artifact. Unzip it and install `app-debug.apk`, allowing installation from that source if asked.
  This is a sideloadable **debug-signed testing APK**, not a Play Store production release.
- Version **0.1.2-alpha** uses the display name **EffectCraft** and the openly licensed unicorn
  app icon (`assets/app-icon/LICENSE.txt`). The package ID remains `io.github.itsnold.ecdroid`
  for compatibility with earlier ECDroid installs and their stored projects/preferences. Updating
  still requires a matching signing key; do not uninstall without backups. Older workflow runs
  call their APK artifact `ecdroid-debug`.
- Version **0.1.1-alpha** fixes startup on WebViews that expose a 4096-pixel texture limit. The
  presentation device requests the adapter's advertised limits instead of requiring 8192-pixel
  textures. CI repeats the touch/save smoke test with a synthetic 4096-pixel WebGL2 adapter.
- The workflow also includes `SHA256SUMS.txt`. A fresh CI debug key may require uninstalling an
  older testing APK before installing another: **export projects first**, since uninstalling erases
  the app's private session/media storage. Never rely on it as your only copy.

## Touch controls

Version **0.1.4-alpha** keeps timeline navigation draggable in Auto: drag the **time ruler or
playhead head** to scrub to a frame, the bottom **time-zoom slider** to change scale, or the top
**navigator handles** to resize the visible time span. These exceptions do not include the
playhead's line through layer rows: swiping across a layer/key underneath it still scrolls safely.
The shortcut bar also provides **Time − / Time + / Fit time** and **Frame ‹ / Frame ›** for exact
one-frame positioning. Two-finger pinch over the timeline's rows zooms its time scale.

Version **0.1.3-alpha** makes timeline/media/effects-list swipes scroll on **both axes** in Auto,
without grabbing layer bars or keyframes. Use **Drag** when you actually want to edit or reorder.
To move through a zoomed timeline, swipe left/right over its time bars. When the whole duration
already fits, pinch to zoom in first; there is no offscreen time to scroll to at Fit.

| Input | Action |
|---|---|
| Tap | Left click / selection |
| Auto mode: vertical swipe in panels / menus | Scroll without selecting or editing the row underneath |
| Auto mode: sideways swipe in timeline / media / effects lists | Scroll, without grabbing layers/keys; timeline names scroll columns on tablets |
| Auto mode: drag in viewer / horizontal drag in other panels | Move or adjust values |
| Auto mode: drag timeline ruler / playhead head | Scrub current time, snapped to frames |
| Drag timeline zoom slider / top navigator handles | Adjust the timeline's time scale |
| Time − / Time + / Fit time shortcuts | Zoom out / in / toggle full-duration fit |
| Frame ‹ / Frame › shortcuts | Move the playhead backward / forward one frame |
| Auto → Scroll → Drag button | Scroll with one finger on either axis, or force editing drags (e.g. reorder layers, resize panel splitters) |
| Drag a scrollbar / near its track | Scroll; custom tracks have a 24 CSS-pixel touch target |
| Hold still for 500 ms | Right-click context menu; no initial left click |
| Two-finger pinch | Zoom timeline time scale or composition around the gesture |
| Two fingers moving together | Scroll panels / timeline (not a layer drag) |
| Hand + drag | Pan composition |
| Shift toggle + tap/drag | Multi-select / constrained editing |
| Alt / Ctrl toggles | Modified gestures otherwise needing a keyboard |
| Viewer / Timeline buttons | Maximize / restore on tablets; switch the main panel on phones |
| Fit | Fit composition and reset pan |

The bottom shortcut bar scrolls horizontally and has 48 × 44 CSS-pixel minimum buttons: Undo,
Redo, Play, Save, Import, Select, Hand, Fit, modifier toggles, panel expansion and Help.
The **UI** shortcut changes editor scale (75–200%); 100% is the default and 75–90% fits more on a
small display. **Esc** dismisses menus/edits and **Delete** clears the current selection. Most
underlying panels still use their desktop layout; not every handle is finger-sized.
Version **0.1.2-alpha** removes the forced 125% scale. Existing installs still at that old default
migrate once to 100%; other custom scales are kept. Layer, footage and preview caches start at
128 MiB each; upgrading does not reset cache preferences. These limits do not bound codec or
worker memory. WebView text/page zoom is disabled so it cannot magnify the canvas a second time.
In Auto, panel tabs and dividers still drag to move/resize. Use Drag for vertical editing
gestures such as reordering layer names or moving/retiming keys. Use Auto to return to safe navigation.
Mouse and pen input retain their native event path. Gesture movement locks to its initial scroll
axis and originating panel, preventing accidental edits or scrolling a neighbouring panel. Rotate,
app-switch, lost pointer capture and cancellation release active gestures and clear stale hover.
Lifting one finger after a pinch cannot become an accidental
click. Adding a second finger during an already-started drag ends that drag; it does not undo it.

## Phone workspace

- **Preview, Timeline, Media, Effects** bottom tabs show one full-width panel at a time; **More**
  opens Effect Controls, Properties, Text, Paragraph, Export Queue and other panels.
- **Menu** searches the editor's actions (e.g. New Composition, New Text, Settings, Render). Import,
  Play, Undo and Save are always at the top; precision tools and **Auto / Scroll / Drag** stay in the
  horizontally scrollable shortcut bar below the tabs.
- The timeline uses a narrower layer-name column and taller rows instead of squeezing desktop
  switches, search and parent columns over the time bars. Desktop column preferences are preserved.
  **Fit time** returns to the composition's full duration. Optional columns remain accessible in
  Tablet layout.
- Phone timeline footer zoom buttons have 44-point targets and a taller slider interaction area.
- **Layout → Auto / Phone / Tablet** overrides automatic detection and is remembered locally.
  Auto selects Phone for windows narrower than 600 CSS pixels or screens with a shortest side below
  600 CSS pixels, so rotating a phone or opening its keyboard does not switch it to the tablet dock.
- Phone presentation does not replace/save the desktop dock, floating groups or maximized panel.
  Returning to Tablet restores those. New-project dialogs and several specialist panels still use
  desktop controls; this is not a complete redesign of every editor dialog.

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
  Android can kill background apps without a shutdown callback. Back first dismisses menus, text edits
  and touch dialogs; otherwise it offers to save/flush before exit.
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
node apps/effectcraft-web/tests/phone.mjs
node apps/effectcraft-web/tests/cache.mjs
node apps/effectcraft-web/tests/service-worker.mjs
node apps/effectcraft-web/tests/touch-browser.mjs --chrome google-chrome
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

The cache regressions cover UUID-based temporary names and WebViews without `randomUUID` or
file moves, including worker writes and failed moves. Service-worker regressions check that
cache-open, lookup and background-write failures do not break a usable network response
(the Android shell itself uses `nosw`). Browser smoke tests also verify the running WASM
engine version matches the workspace, preventing a stale bundle from passing unnoticed.

## Known limitations / what is not promised

- This is a WebView/WASM port, **not** a native Android NDK port or a CapCut Pad clone. No Android
  hardware video encoder/decoder integration or background rendering service has been added.
  Phone navigation/timeline are adapted; many specialist panels/dialogs are still desktop-oriented.
  Desktop engine limitations still apply.
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

The 0.1.2 touch changes were imported from the contributor-supplied
[source ZIP](https://drive.google.com/file/d/1ykb9W51If4Dg5CYB1lK6W0l3n6Kz1q8H/view),
based on commit `bd2eba780a867ffddce243010fea9c7927e63e64`. Its archive SHA-256 is
`c32340146403571537df5082f1129d2bc7dedfe1a701220b3f1c3617537a0e31`;
the 13 source-file hashes were checked against its manifest before applying the patch.

The references support tablet workspace design, not an assertion that CapCut uses our exact gestures:

- [CapCut Pad announcement, 16 Dec 2025](https://www.prnewswire.com/news-releases/introducing-capcut-pad--a-new-editing-experience-designed-for-ipad-creators-302643707.html):
  rebuilt large-screen workspace, touch/pen input and multi-track editing.
- [CapCut's Pad page](https://www.capcut.com/tools/capcut-for-ipad): timeline clarity, layers and
  touch-oriented keyframe controls.
- [CapCut iPad precision guidance](https://www.capcut.com/help/can-not-select-functions-on-ipad):
  small controls and gesture conflicts are real problems; a scaled desktop UI alone is not enough.

This port uses generic touch conventions and original code, without reading or copying a proprietary
app's implementation or bundling its assets. Upstream restricted trademark artwork is removed.
