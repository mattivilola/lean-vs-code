# Lean VS Code v0.3.1

Lean VS Code now supports automatic app updates on Apple Silicon Macs. The existing Code-OSS update controls check a stable feed hosted on GitHub Releases, download a ZIP containing the signed and notarized app, and offer **Restart to Update** when a newer release is ready. The DMG remains the first-install and manual-recovery format. The app uses Electron's macOS updater, so it does not need a second native update framework. A previously downloaded update may still install on normal quit even after future checks are disabled.

**Users of v0.3.0 must install this DMG once by hand.** That version did not include an updater; v0.3.1 can receive later stable releases automatically. Settings still offer automatic, startup-only, manual, and disabled update checking. Automatic work waits until after the first window opens and defers downloading on metered connections.

This release keeps the familiar Code-OSS 1.139.1 editing, search, terminal, local Git review, and extension platform. The 33 curated bundled extensions and Open VSX extension installation remain available. The v0.3.0 [same-revision Code-OSS comparison](PERFORMANCE.md) measured 18% less time to an editable file and 13% lower idle app-tree footprint on the reference Apple M3 Max. Those figures belong to v0.3.0; they are not a fresh v0.3.1 speed or memory claim.

The app was built from fork commit `466cdb1842eec4244e2d344d9607391cff003251` on the Code-OSS 1.139.1 base. Both the update ZIP and DMG contain byte-identical app files and symlink targets across 2,236 bundle paths. The app and DMG passed Developer ID signature verification, Apple notarization and ticket validation, and macOS Gatekeeper assessment. The feed's ZIP hash and byte size were checked against the generated ZIP.

- DMG SHA-256: `543238dfd6905e33f52b1a71eb340217f2dbcde98e99fd05249d5464c08b047d`
- Update ZIP SHA-256: `8295f345687ba4b8116f1218baa1a94cbd8d640acaf27a39a39ff462c1d975c0` (205,510,712 bytes)

The build passed TypeScript client checking, the production compile, focused updater tests (25 passing), and JavaScript linting. The extracted signed app opened an isolated Git workspace; its CLI installed and listed EditorConfig 0.18.2 from Open VSX. The release remains Apple Silicon-only and uses full ZIP updates; delta packages are not implemented. A native end-to-end update trial against the live stable feed and a v0.3.1 performance rerun should be recorded here once the feed is public.
