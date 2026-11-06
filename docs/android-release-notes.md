# EffectCraft Android 0.2.2-alpha

First public alpha of the **unofficial Android fork**, based on EffectCraft v0.21.1.
This is the Android-compatible EffectCraft editor, not an official ArtCraft Android release.

## What's changed

- A consistent dark mobile style, clearer selected/focus states and labelled timing fields.
- Responsive bottom sheets on phones and centred dialogs on tablets; background interaction is
  blocked while a sheet is open, with keyboard focus containment and Back/Escape dismissal.
- Direct, swipeable shortcut bar: no extra **Tools** tap for Undo/Redo, scale, frame steps or modifiers.
- Upstream v0.21.1 engine/editor update, retaining Android layouts, touch controls, storage and the
  adapter-aware 4096-pixel WebGL fallback. New upstream features are not all device-validated.
- Keyframe box selection uses upstream's glyph hit-testing with phone row heights and edge scrolling.
- Browsable File/Edit/Composition/Layer/Effect/Animation/View/Window/Help menus on phones.
- Selection actions, precise frame timing, keyframe easing, touch trimming and box selection.

## Install and back up first

Download `EffectCraft-Android-0.2.2-alpha.apk` and allow installation from your browser/file manager.
Check its SHA-256 against `SHA256SUMS.txt`. Requires Android 10+, OpenGL ES 3 and a recent Android
System WebView. This is not a Play Store release.

This APK is a **non-debuggable release build**, signed with the fork's permanent release key.
It is not the debug-signed APK from Actions. The package remains `io.github.itsnold.ecdroid`,
version code **13**; future public APKs must retain this signing certificate.

Signing certificate SHA-256 (not the APK checksum):

```text
CD:14:4E:25:C7:F8:1C:26:4C:2E:47:03:5C:4B:C4:F6:9F:35:20:54:09:57:80:9B:77:D2:AB:3D:4C:23:20:98
```

Existing debug builds may have a different signing key. **Export your projects and source media
before uninstalling an older build**; uninstalling erases private app storage. Subsequent public
updates must use the same release key.

## Known limitations

Alpha software: start with short, small projects. This is a WebView/WASM editor, not a hardware-
accelerated native video pipeline. Heavy effects/software video exports may be slow or exhaust
memory. Background rendering and recovery after Android kills the process are not guaranteed.
Some specialist panels remain desktop-oriented. Keep external copies of projects and media.

## Compatibility and validation

The maintainer reports that the current Android development build works. A device-model,
Android-version and WebView-version matrix has **not yet been recorded**, so this is an early
community alpha, not a certification of every phone or tablet. There is no measured RAM/chipset
minimum. Begin with short 720p projects and back up project files and source media externally.

The preceding source build passed [APK/browser validation and the full Rust quality gate](https://github.com/itsnold/effectcraft/actions/runs/42195399214).
The signed release must also pass both jobs and signature/non-debuggable checks before publication.
Release-signed installation, recovery and device-specific acceptance remain tracked in
[the release checklist](https://github.com/itsnold/effectcraft/blob/android/docs/android-release.md).

Source and licences: https://github.com/itsnold/effectcraft (MIT OR Apache-2.0; asset notices in
ATTRIBUTION.md and the packaged licences). Original EffectCraft: https://github.com/storytold/effectcraft.
