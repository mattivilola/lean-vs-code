# Changelog

This file records public Lean VS Code releases and withdrawn candidates. The [release notes](lean/docs/) provide build evidence and limitations; [performance results](lean/docs/PERFORMANCE.md) distinguish each Lean version from the same-revision Code-OSS baseline.

## Unreleased

Before each release, move these notes under the new version, link its release notes, and update the README and website to match the published artifacts. Keep corrections and withdrawn candidates visible rather than rewriting release history.

- v0.11 candidate: load MCP HTTP route/session code on first gateway creation, retaining immediate service/channel registration. Node HTTP and lifecycle checks cover initialize, tool requests, SSE, concurrent gateways, route refresh, teardown races and load retry. The isolated main-app static graph is 15,283 unminified bytes smaller; no startup or memory gain is claimed.

## 0.10.0

See the [v0.10.0 release notes](lean/docs/RELEASE_NOTES_0.10.0.md) and [GitHub release](https://github.com/mattivilola/lean-vs-code/releases/tag/v0.10.0) for the exact build, validation, and limitations.

- Load automatic chat-instruction collection only for eligible extension-backed requests and MCP request handling only after a server starts. Preserve cancellation and stop behavior; focused ChatService, instruction, and MCP tests pass.
- Isolate two small constants so the initial renderer no longer loads their larger optional modules solely for a string. The tunnel cut saves only 144 emitted bytes and is documented without a standalone speed claim.
- Together, v0.10.0 reduces the initial static unminified desktop JavaScript graph by 49,387 bytes versus v0.9.0. This is code-loading evidence, not a measured launch-time or runtime-memory saving. Routine minor releases use focused checks by default; full paired GUI runs need a major release or the owner's request.
- At the owner's request, a complete 30-pair signed-app GUI comparison against original same-revision minified Code-OSS measured **1.471 versus 1.903 s median** to an extension-editable file from launch: **23% less time**. The p95 was **1.596 versus 2.141 s**. Existing-window file opens were **416 versus 403 ms median**, a small Lean regression. The sub-second p95 goal remains open.
- Sign and notarize the Apple Silicon app, updater ZIP, and DMG. The exact signed app passed compact no-timing edit/save, search, terminal, Git diff, webview, and installed Open VSX extension checks. Its apparent app content is **64.9% smaller** than original same-revision minified Code-OSS: 514 versus 1,463 MiB. This is a disk-bundle result, not a runtime-memory or download-size claim.
- A separate nine-pair signed short-idle memory run recorded 395 versus 524 MiB median app-tree footprint, but three pairs favored Code-OSS as GPU modes varied; keep the raw result and do not present this as a stable per-launch memory reduction.

## 0.9.0

See the [v0.9.0 release notes](lean/docs/RELEASE_NOTES_0.9.0.md) and [GitHub release](https://github.com/mattivilola/lean-vs-code/releases/tag/v0.9.0) for the exact build, focused validation, and limitations.

- Extract Agent Merge request labels from the DOM widget, defer the optional session hover widget until first use, and defer terminal approval analysis modules until a nonempty command needs suggestions. The three cuts remove 58,471 unminified bytes from the initial desktop static JavaScript graph compared with v0.8.0; this is not a measured startup or runtime-memory saving.
- Keep editing, local Git review, search, terminal, and extension APIs intact. Focused typecheck, lint, AI/DI/actor guard, and headless Chromium tests passed. The exact signed app also passed compact, isolated no-timing checks for edit/save, search, terminal, Git diff, extension webview, and Open VSX EditorConfig installation and activation.
- Sign and notarize the Apple Silicon app, updater ZIP, and DMG. The signed app bundle has **64.9% less apparent file content** than original same-revision minified Code-OSS: 514 versus 1,463 MiB. No v0.9 startup or runtime-memory percentage is claimed; the full paired GUI comparison waits for a major release or explicit request.

## 0.8.0

See the [v0.8.0 release notes](lean/docs/RELEASE_NOTES_0.8.0.md) and [GitHub release](https://github.com/mattivilola/lean-vs-code/releases/tag/v0.8.0) for the exact build, validation, and limitations.

- Move four retained optional chat, terminal-context, pet-renderer, and image-hash paths out of the initial desktop renderer graph while keeping the editor and extension API intact. The [optimization ledger](lean/docs/OPTIMIZATION_LEDGER.md) records byte-level graph evidence, focused tests, and rejected experiments. These cuts have **no new measured startup or runtime-memory percentage**.
- Keep all 87 extension API actors registered and pass the AI/service guard. Focused proxy, pet, image-hash, and paste tests passed. The built-in chat and agent UI remain removed.
- Build, sign, and notarize the Apple Silicon app, updater ZIP, and DMG. The exact signed app passed compact, isolated, no-timing checks for edit/save, search, terminal, Git diff, extension webview, and Open VSX EditorConfig installation and activation.
- The signed app bundle is **64.9% smaller by apparent file content** than the original same-revision, locally repaired minified Code-OSS source package: 514 versus 1,463 MiB. This disk result is not a runtime-memory or download-size claim. The full paired GUI performance comparison remains deferred until a major release or explicit request.

## 0.7.0

See the [v0.7.0 release notes](lean/docs/RELEASE_NOTES_0.7.0.md) for validation and benchmark limitations.

- Omit the unused separate Agents window bundle from the macOS desktop package, removing about 20.5 MiB of resources. Requests for that window open a regular editor window, and workspaces saved by older builds can still open as ordinary workspaces.
- On macOS zsh, bash, and sh launches, collect the login-shell environment with the system `env -0` command instead of starting another Electron process solely to serialize it. Other shells retain the original collector. A nine-pair candidate diagnostic improved extension-editable file readiness versus installed v0.6.0. This release makes no new startup percentage claim; earlier speed results remain labeled with the version measured.
- Let GUI test launches use the same compact, bottom-left window for both apps. An experimental main-process Node compile cache was removed after its paired startup trial did not show a reliable improvement.
- Sign and notarize the Apple Silicon app, update ZIP, and DMG. The signed v0.7.0 app bundle contains 513 MiB of apparent file content versus 1,463 MiB for the original, same-revision minified Code-OSS package: **64.9% smaller**. This is disk content, not a runtime-memory or download-size claim. Full paired GUI comparisons now run only for major releases or when explicitly requested.
- Publish the stable GitHub feed and confirm the v0.6 → v0.7 in-app update on the reference Mac. The installed v0.7.0 bundle reports the expected app identity and passes strict deep signature verification.

## 0.6.0

See the [v0.6.0 release notes](lean/docs/RELEASE_NOTES_0.6.0.md) for benchmark methods, release checks, and limitations.

- Bundle **Lean VS Code Light** for daytime use and rename the existing emerald theme in the picker to **Lean VS Code Dark**. Existing dark-theme selections continue to work.
- Activate the bundled Git extension after startup (`onStartupFinished`) instead of only when Source Control opens. Gutter change markers, the branch indicator, and change counts are available for reviewing edits without an extra click; activation stays off the critical startup path. The earlier on-demand change had shown no measured file-ready gain.
- Start resolving the login-shell environment as soon as main-process services exist, instead of after the first window opens. Finder, Dock, and direct launches no longer delay the local extension host by the full shell startup time; `code` CLI launches already skip this step.
- Enable Node's compile cache for the extension host, shared process, and terminal host, stored in the existing per-commit code-cache folder.
- Pin `@vscode/vsce-sign` to an exact version.
- Remove the built-in AI surfaces from the desktop workbench: chat, agent sessions, inline chat, MCP management UI, voice, AI customization, and agent-host UI. Upstream AI sources stay in the repository and only their imports are cut, so upstream merges stay simple. Core services that upstream code still injects are registered from one Lean module, and every extension API actor remains available: `vscode.lm` returns no models and MCP server definition providers still register. The unminified desktop workbench bundle shrinks from 40.2 MB to 34.9 MB, and the minified JavaScript from 19.4 MB to 16.9 MB. No separate runtime-memory reduction is attributed to this change.
- Add `npm run lean:check-ai`, a build guard that fails if AI modules outside the committed allowlist return to the renderer bundle, if a bundled module injects an unregistered service, or if an extension-host protocol actor is missing.
- Extend the performance harness with CLI and Finder launch modes, established (reused) profiles, control extensions installed from a VSIX instead of an extension-development host, and per-process memory roles, so daily-use launches can be measured.
- Verify the signed and notarized Apple Silicon app, update ZIP, and DMG. The packaged app is 535 MiB of apparent content versus 1,463 MiB for the original, same-revision minified Code-OSS package: 63.4% smaller on disk. No new v0.6 runtime-memory percentage is claimed.

## 0.5.0

- Begin local extension initialization at workbench Ready instead of adding an idle-callback wait. The signed release reached an extension-editable file in 1.653 s median / 2.009 s p95 versus 1.960 / 2.254 s for original, same-revision minified Code-OSS in 30 alternating GUI pairs: 16% less median time. The sub-second p95 target remains open.
- Keep editing, verified workspace text search, integrated terminal commands, local Git diffs, extension webviews, and signed Open VSX installs working. The app and matching update ZIP/DMG passed Developer ID, notarization, stapled-ticket, and Gatekeeper checks.
- Measure the installed bundle at 538 MiB apparent content versus 1,463 MiB for original minified Code-OSS: 63.2% less. The separate v0.4.0 independent-launch memory result remains version-labeled; v0.5.0's single-launch memory snapshots are not used as a public saving claim.
- Record unsuccessful startup experiments and keep their optional feature implementations intact. The GitHub update feed continues to serve signed, notarized updates.

See [v0.5.0 release notes](lean/docs/RELEASE_NOTES_0.5.0.md), the [v0.5.0 raw benchmark](lean/performance/v0.5.0-vs-code-oss-1.139.1-minified.json), and the [performance history](lean/docs/PERFORMANCE.md).

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
