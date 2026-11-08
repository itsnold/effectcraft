# Android public alpha release checklist

0.22.0-android.0.2.4-alpha is the next **public-alpha candidate**, not a claim that all Android devices work. The existing
debug APK workflow remains available for development. Public releases use a separate persistent key.

## Signing setup (maintainer)

Create or reuse a release keystore you own, outside the checkout. Keep two secure backups of the
keystore, alias and passwords. Losing the key prevents updates to installed copies. Never put the
key/passwords in a commit, issue, artifact or chat. Configure these repository Actions secrets:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded keystore file.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing alias.
- `ANDROID_KEY_PASSWORD`: private-key password.

The workflow does not generate a key or fall back to debug signing. Check the certificate SHA-256
fingerprint in the signing step against your own keystore; retain that fingerprint for every update.

The first release identity was created on **2026-11-07** and the four repository secrets configured.
Its certificate SHA-256 is:

```text
CD:14:4E:25:C7:F8:1C:26:4C:2E:47:03:5C:4B:C4:F6:9F:35:20:54:09:57:80:9B:77:D2:AB:3D:4C:23:20:98
```

The encrypted keystore and verified encrypted recovery archive are stored outside the repository.
**Off-device backup confirmation is still required before first publication.** Never recreate this
identity for a later update or expose the recovery password in logs, artifacts or chat.

## Build and review

1. Run **Android APK** on branch `android`, with `release_candidate` enabled.
2. The APK/browser/JVM/lint checks AND the full Rust gate must pass before signing starts.
3. The final job aligns, signs, verifies the non-debuggable APK and creates a **draft prerelease**
   tagged `v0.22.0-android.0.2.4-alpha`, containing the APK and `SHA256SUMS.txt`. Nothing is auto-published.
4. Download the signed draft asset and complete the device checks below. Record device model,
   Android/WebView versions, results and any limitations in the release notes.
5. Verify the repository and release will be publicly accessible; publish the draft only after
   review. Link the release from README. Users download the `.apk` directly, not an Actions ZIP.

The draft tag is not overwritten automatically. If a candidate fails review, fix it and increment
the version code/name and release tag before producing another candidate.

## Required device checks

- [ ] Fresh release-signed install and offline launch on a real phone.
- [ ] Real tablet, portrait/landscape, narrow split window, keyboard opening/closing.
- [ ] System Back closes a sheet first; keyboard and focus do not get stuck.
- [ ] All menus, direct shortcut-bar buttons, selection actions, precision timing and modifier controls are reachable.
- [ ] Import an image and a small video; add/edit text; animate, trim, select, undo and preview.
- [ ] Save project and source media externally; reopen after force-stop with media available.
- [ ] Background/process-death recovery is tested and its actual limits documented.
- [ ] Video/image export opens and plays in an external viewer.
- [ ] Cancel save/export, deny a provider write, run low on storage: no false success or lost work.
- [ ] Update from an earlier APK signed with the SAME release key without losing stored projects.
- [ ] Readable large-text layout, focus outlines, labelled controls and reduced-motion setting.
- [ ] Checksum and signing fingerprint match the exact APK being published.

## Migration from testing builds

The package ID stays `io.github.itsnold.ecdroid`. Previous Actions APKs used debug keys, which may
not match this release key. Android can reject an in-place update. **Export projects AND source
media before uninstalling**: uninstalling removes private storage. Do not claim a seamless migration
until tested with the specific old signing certificate. Later public releases must retain the key.

## Scope and honest limits

This is an unofficial WebView/WASM alpha based on EffectCraft v0.22.0. Android 10+, OpenGL ES 3,
and a recent System WebView are required. Start with small projects. Hardware video acceleration,
background rendering and guaranteed recovery after process death are not promised. Many specialist
editor dialogs are still desktop-oriented. Include these limits, source/licence links and backup
instructions in public notes. CI/browser screenshots do not substitute for device testing.
