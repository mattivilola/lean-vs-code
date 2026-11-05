# Lean VS Code v0.10.1 release notes

v0.10.1 adopts the approved CRT family branding while retaining the released v0.10 editor base. The editor has a teal CRT with mint braces; the emerald terminal prompt now belongs to sibling [Lean Term](https://leanterm.com), currently in development. Bundle identity, settings, extension storage, update feed, and the unnumbered **Lean VS Code.app** name stay the same.

## Scope and provenance

The branch starts from stable `origin/main` at `602e4d2465465335930b58389902bee317f39b31`. It includes the separately completed duplicate-registration workflow fix and approved branding, without the unfinished v0.11 browser/main-process experiments. The frozen asset manifest SHA-256 is `18a7151b799295c67a73fecc146b4e8f2dba5ddf962e56eb5947787fbc907b6a`; all 70 original files were verified before integration. The editor ICNS is copied without modification. Windows ICO frames retain approved PNG bytes; Windows tile derivatives use the required 70/150 dimensions. Generic file/language icons and third-party logos are unchanged.

Development bundles no longer register file/URL handlers. Release staging restores those handlers before signing. Temporary release and test copies are unregistered on cleanup, preserving `/Applications/Lean VS Code.app` and user data.

## Validation and publication

The production-minified app was built from `5cec70a501f3d9dfa3d82d5828faedab9dd78a53`, using Node 24.21.0 and Electron 43.6.0. The AI/DI/actor guard passed with zero missing registrations and all 87 MainContext actors; build-tool typecheck and changed TypeScript lint passed. Six registration tests pass. The [source preflight](../performance/v0.10.1-source-functional-no-timing.json) edited, saved and verified a fixture on disk in an isolated compact window.

The [exact signed DMG-app check](../performance/v0.10.1-release-functional-no-timing.json) passed all seven checks: edit/save, 401-file project search, 400-file text search, integrated terminal, local Git diff, extension webview, and installed/activated Open VSX EditorConfig 0.18.2. No GUI timings were collected.

The [artifact report](../performance/v0.10.1-release-artifacts.json) verifies matching ZIP/DMG app contents across 2,218 entries; independent strict deep signatures, stapled tickets and Gatekeeper checks; restored release document/URL handlers; unchanged bundle/name/storage/update identity; exact approved ICNS bytes; and the feed's ZIP size/hash. The ZIP is 192,180,212 bytes, SHA-256 `8504fe2c2543fb98803d496deef0a23408cd17c613ccdb05f69ff68fcb5eb758`. The DMG is 205,596,353 bytes, SHA-256 `0443bbc15810c20e53009d2d716fb66b705f05b73da9104296044c94dabe3807`.

Apple accepted app submission `ee28cdfd-ec7f-4e8d-985b-f3a27835bc64` and DMG submission `ecb59ba7-ce84-4b45-aebc-228672781916`. The first accelerated S3 upload failed with `connectTimeout`; Apple confirmed that submission did not exist. One bounded retry through the normal S3 endpoint succeeded. The workflow now prints accepted IDs and retains task-owned failure staging for recovery. A mounted-copy cleanup error was resolved only after the complete Launch Services dump proved that copy was absent and the canonical install was present; genuine errors and incomplete dumps still fail closed.

Publication status: GitHub release/live feed, isolated native A-to-B update trial, and Site version 31 deployment remain pending. The installed `/Applications/Lean VS Code.app` has not been patched or force-closed; its updater can install the published release on a normal quit or Restart to Update. No full GUI benchmark or new speed/memory claim is planned for this patch.

The website preserves the measured v0.10 and historical Code-OSS comparison labels and adds a modest in-development Lean Term link. Do not treat these previous results as a new v0.10.1 timing or memory measurement.
