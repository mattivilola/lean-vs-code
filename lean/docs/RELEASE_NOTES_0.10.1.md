# Lean VS Code v0.10.1 release notes

v0.10.1 adopts the approved CRT family branding while retaining the released v0.10 editor base. The editor has a teal CRT with mint braces; the emerald terminal prompt now belongs to sibling [Lean Term](https://leanterm.com), currently in development. Bundle identity, settings, extension storage, update feed, and the unnumbered **Lean VS Code.app** name stay the same.

## Scope and provenance

The branch starts from stable `origin/main` at `602e4d2465465335930b58389902bee317f39b31`. It includes the separately completed duplicate-registration workflow fix and approved branding, without the unfinished v0.11 browser/main-process experiments. The frozen asset manifest SHA-256 is `18a7151b799295c67a73fecc146b4e8f2dba5ddf962e56eb5947787fbc907b6a`; all 70 original files were verified before integration. The editor ICNS is copied without modification. Windows ICO frames retain approved PNG bytes; Windows tile derivatives use the required 70/150 dimensions. Generic file/language icons and third-party logos are unchanged.

Development bundles no longer register file/URL handlers. Release staging restores those handlers before signing. Temporary release and test copies are unregistered on cleanup, preserving `/Applications/Lean VS Code.app` and user data.

## Validation and publication

Pending before publication: production-minified build; AI/DI/actor guard; compact no-timing signed-app editing, search, terminal, Git-review, webview and installed-extension checks; exact packaged icon/identity verification; app and DMG signing/notarization/stapling; ZIP/DMG content equivalence and update-feed hash/size checks; GitHub release and live feed; website deployment. Four registration tests pass in the initial source checkpoint. No full GUI benchmark or new performance claim is planned for this patch.

The website preserves the measured v0.10 and historical Code-OSS comparison labels and adds a modest in-development Lean Term link. Do not treat these previous results as a new v0.10.1 timing or memory measurement.
