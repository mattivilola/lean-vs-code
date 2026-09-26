# Changelog

This file records public Lean VS Code releases and withdrawn candidates. The [release notes](lean/docs/) provide build evidence and limitations; [performance results](lean/docs/PERFORMANCE.md) distinguish each Lean version from the same-revision Code-OSS baseline.

## Unreleased

Add user-visible changes here as they land. Before each release, move them under the new version, link its release notes, and update the README and website to match the published artifacts. Keep corrections and withdrawn candidates visible rather than rewriting release history.

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
