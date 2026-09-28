# Changelog

This file records public Lean VS Code releases and withdrawn candidates. The [release notes](lean/docs/) provide build evidence and limitations; [performance results](lean/docs/PERFORMANCE.md) distinguish each Lean version from the same-revision Code-OSS baseline.

## Unreleased

Add user-visible changes here as they land. Before each release, move them under the new version, link its release notes, and update the README and website to match the published artifacts. Keep corrections and withdrawn candidates visible rather than rewriting release history.

## 0.4.0 bundle and memory addendum — 28 September 2026

- Measured the installed signed v0.4.0 bundle at 538 MiB apparent file content versus 1,463 MiB for the same-revision minified Code-OSS source package, 63% less. The signed Lean DMG is 206.8 MB; no matched Code-OSS DMG was measured. See the [bundle-size method](lean/docs/PERFORMANCE.md).
- In a separate nine-pair independent-launch trial, measured 655 MiB versus 786 MiB median short-idle app-tree footprint for signed Lean and matched Code-OSS, 16.7% less. This 100 KiB isolated-profile result does not establish peak, long-session, or extension-heavy memory use. See the [raw observations and method](lean/performance/v0.4.0-independent-memory-vs-code-oss-1.139.1-minified.json).

## 0.4.0 benchmark addendum — 27 September 2026

- Validated a minified, same-revision original Code-OSS source comparator and ran 30-pair standalone-file, 10,000-file repository, Git-review, first saved-edit, integrated-terminal, and verified workspace text-search benchmarks. The matched-build median differences are 17%, 19%, 21%, 25%, 13%, and 25% less full-workflow time, respectively, for signed Lean v0.4.0. Earlier unminified-comparator results remain labeled for audit; the public headline now uses the minified baseline. See the [method and raw observations](lean/docs/PERFORMANCE.md).
- Added a separate first-visible-file diagnostic: requested text reached the editor DOM in 0.999 s median / 1.073 s p95 for Lean versus 1.115 / 1.134 s for same-revision Code-OSS. This is a DOM visibility proxy, not the primary editable-file result or a sub-one-second p95 claim.
- Added a separate 30-pair stopped-process test using each app's established profile after warm-up. Lean reached an editable file in 1.413 s median versus 1.461 s for same-revision Code-OSS, a 3% gain in this condition. The fresh-profile 17% headline does not describe this established-profile result.
- Added a 30-pair first UI edit diagnostic using the same synthetic Monaco input in both apps. Lean showed the edit in 1.203 s median versus 1.334 s for same-revision Code-OSS, about 10% less time; this is separate from saved-file and extension-backed editability.

## 0.4.0

- Built the Apple Silicon release with the production-minified workbench. In a 30-pair GUI trial on the reference Mac, the signed app reached an editable file in 1.239 s median / 1.268 s p95, versus 1.310 s / 1.353 s for signed v0.3.2 in the same run: about 5% less median time and 6% less p95 time.
- Removed an eager remote-service listener lookup from the renderer startup path and began the shared utility process's existing initialization after the first real window opens. Editing, workspace search, terminal, local Git review, an extension webview, and signed Open VSX installation passed release checks.
- Added a startup trace helper, a repeatable GUI functional smoke, and path-sanitized public benchmark reports. A bundled-extension index and early scan were tested but not shipped because they did not improve the editable-file result.
- Kept the existing signed GitHub auto-update mechanism. The v0.4.0 release remains Apple Silicon-only. The sub-second p95 goal is still open, and this release does not claim lower idle memory than v0.3.2.

See [v0.4.0 release notes](lean/docs/RELEASE_NOTES_0.4.0.md) and the [performance method and history](lean/docs/PERFORMANCE.md).

## 0.3.2

- Added automatic update checks and downloads for the Apple Silicon app through a GitHub-hosted stable feed and signed, notarized app ZIP. The familiar update controls offer restart to install; `update.mode` can change future checks.
- Corrected the packaged Electron app version to the Lean release number while retaining Code-OSS 1.139.1 as the extension API version.
- Published a signed, notarized DMG for first installs and manual recovery. Users of 0.3.0 or the withdrawn 0.3.1 candidate need this one-time manual install.
- Retained the focused editor, local Git review, and optional Open VSX extensions. The public performance figures remain explicitly attributed to the measured 0.3.0 minor release; routine patch releases do not get a new full comparison.

See [v0.3.2 release notes](lean/docs/RELEASE_NOTES_0.3.2.md) and the [GitHub release](https://github.com/mattivilola/lean-vs-code/releases/tag/v0.3.2).

## 0.3.1 — withdrawn candidate

- The candidate was briefly published, then returned to draft after a native update trial found a packaged-version mismatch that prevented its updater from recognizing the next Lean version correctly.
- Its tag and notes remain as an audit trail. Use the 0.3.2 DMG for a manual upgrade; 0.3.1 is not a supported auto-update release.

See the [withdrawal notes](lean/docs/RELEASE_NOTES_0.3.1.md).

## 0.3.0

- Measured the signed release against original Code-OSS at the same upstream revision on an Apple M3 Max: an editable file in 1.64 s versus 2.00 s median (18% less time), and 746 MiB versus 854 MiB median idle app-tree footprint (13% lower). These are reference-machine results, not guarantees for every Mac or project.
- Deferred bundled Git extension activation until Source Control, a Git resource, or a Git command needs it. Local change review and side-by-side diffs remain available.
- Preserved editing, search, terminal, and optional Open VSX extensions. This release had no automatic updater.

See [v0.3.0 release notes](lean/docs/RELEASE_NOTES_0.3.0.md) and the [benchmark method and history](lean/docs/PERFORMANCE.md).

## 0.2.0

- First signed and notarized Apple Silicon DMG, with a separate app identity and storage, emerald branding, and a visible Lean version alongside the Code-OSS extension API version.
- Shipped 33 curated built-in extensions; kept local Git review, Open VSX searches and installs, and local VSIX installation. Verified signed Open VSX packages against a pinned registry key.
- Turned off default telemetry, experiments, update checks, extension recommendations, onboarding, and built-in AI surfaces.
- Removed generated JavaScript source maps from the release app, saving about 227 MiB of uncompressed disk space without claiming a runtime-memory gain.

See [v0.2.0 release notes](lean/docs/RELEASE_NOTES_0.2.0.md).
