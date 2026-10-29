# EffectCraft Android 0.2.0-alpha

First-public-alpha candidate of the **unofficial Android fork**, based on EffectCraft v0.17.0.

## What's changed

- A consistent dark mobile style, clearer selected/focus states and labelled timing fields.
- Responsive bottom sheets on phones and centred dialogs on tablets; background interaction is
  blocked while a sheet is open, with keyboard focus containment and Back/Escape dismissal.
- Compact editing tray with advanced shortcuts under **Tools** rather than an endless button strip.
- Browsable File/Edit/Composition/Layer/Effect/Animation/View/Window/Help menus on phones.
- Selection actions, precise frame timing, keyframe easing, touch trimming and box selection.

## Install and back up first

Download `EffectCraft-Android-0.2.0-alpha.apk` and allow installation from your browser/file manager.
Check its SHA-256 against `SHA256SUMS.txt`. Requires Android 10+, OpenGL ES 3 and a recent Android
System WebView. This is not a Play Store release.

Existing debug builds may have a different signing key. **Export your projects and source media
before uninstalling an older build**; uninstalling erases private app storage. Subsequent public
updates must use the same release key.

## Known limitations

Alpha software: start with short, small projects. This is a WebView/WASM editor, not a hardware-
accelerated native video pipeline. Heavy effects/software video exports may be slow or exhaust
memory. Background rendering and recovery after Android kills the process are not guaranteed.
Some specialist panels remain desktop-oriented. Keep external copies of projects and media.

## Maintainer acceptance — complete before publishing this draft

Device checks are **not yet recorded**. Complete [the release checklist](docs/android-release.md),
replace this section with tested device/Android/WebView versions and workflow results, and list
remaining device-specific issues. A green CI run alone is not approval to publish.

Source and licences: https://github.com/itsnold/effectcraft (MIT OR Apache-2.0; asset notices in
ATTRIBUTION.md and the packaged licences). Original EffectCraft: https://github.com/storytold/effectcraft.
