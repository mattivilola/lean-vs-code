# Lean VS Code v0.6.0 — release candidate

**Status: release candidate, not released.** The full paired GUI runs below measured the unsigned minified candidate at `48da33a316848c7be14416f3ece87c2dad034d34` against original Code-OSS from `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`. A light-theme commit landed after that build; the exact final release app still needs packaging and verification. No v0.6 memory-saving claim is supported by the current samples.

v0.6.0 focuses on the everyday way the editor is used: opening files from the terminal or Finder with a profile that has been used before, and reviewing local changes.

## What changed

- **Daytime theme.** Lean VS Code Light is bundled alongside the existing emerald dark palette. The Color Theme picker shows **Lean VS Code Light** and **Lean VS Code Dark**; existing dark-theme selections are preserved.
- **No built-in AI.** Chat, agent sessions, inline chat, the MCP management UI, voice, AI customization, and agent-host UI are no longer part of the desktop workbench. The upstream sources stay in the repository and only their imports are cut, which keeps upstream merges simple. Services that core upstream code still injects are registered from one Lean module (`src/vs/workbench/contrib/leanAi`). Every extension API remains available: `vscode.lm` reports no language models, MCP server definition providers can still register, and chat participant or tool registrations from installed extensions have no built-in UI to appear in.
- **Smaller renderer bundle.** The unminified desktop workbench bundle shrinks from 40.2 MB to 34.9 MB. The packaged minified workbench JavaScript is 16.97 MB versus 19.35 MB in installed v0.5.0, and its CSS is 1.43 MB versus 1.69 MB. These are file sizes, not measured runtime-memory reductions; the whole-app comparison to original Code-OSS is recorded separately.
- **Extension host starts earlier on Finder and Dock launches.** The login-shell environment is resolved as soon as main-process services exist instead of after the first window opens. The extension host waits for that environment, and resolving it took about 0.6 s on the reference Mac. In a diagnostic trace, the extension host now started before extension scanning had finished instead of about 60 ms after it. `code` CLI launches already skip shell resolution.
- **Node compile cache** for the extension host, shared process, and terminal host, stored in the existing per-commit code-cache folder (`CachedData/<commit>/node`) and cleaned with it. It benefits repeated launches with an established profile.
- **Git is active after startup.** Gutter change markers, the branch indicator, and change counts appear without opening Source Control first. Activation happens after startup finishes, so it stays off the path to an editable file. The earlier on-demand activation had shown no measured file-ready gain. As in upstream Code-OSS, Git runs only in trusted workspaces.
- **Build guard.** `npm run lean:check-ai` fails if built-in AI modules return to the renderer bundle after an upstream merge, if a bundled module injects an unregistered service, or if an extension-host protocol actor is missing.
- **Measurement tooling.** The performance harness can launch through the CLI or Finder, reuse an established profile, install its control extension from a VSIX (an extension-development host disables the extension-host code cache and bypasses workspace trust), and report memory per process role.

## Verified on the candidate

- TypeScript type check with 0 errors; ESLint with 0 errors and 0 warnings on changed files.
- `npm run lean:check-ai`: 0 missing service registrations and all 87 extension-host protocol actors registered.
- Focused unit tests: LanguageModels (58), MCP (303 passing, 16 pending), agent-host usage sidecar (2). The Git activation integration test was updated to expect activation after startup.
- GUI functional smoke on the minified candidate: edit and save verified on disk, workspace file search, 10 expected text matches across 400 files, an integrated terminal command, a local Git diff through the Git API, and an extension webview. No actor, service-registration, or renderer errors in the logs.
- Git activated after startup and opened the repository in a trusted workspace; a normally installed Open VSX extension (EditorConfig 0.18.2, `onStartupFinished`) activated in both the candidate and v0.5.0.
- The Node compile cache was written to `CachedData/<commit>/node` during the smoke run.
- The Git extension integration suite passed: 58 tests, 2 pending, including activation without a user action and opening a local diff.

## Paired candidate benchmarks

All figures below compare the v0.6 candidate with the **original, same-revision minified Code-OSS source build**, on the same Apple M3 Max in 30 alternating pairs per endpoint. The comparator has a packaging-only runtime-dependency repair and local ad-hoc signature. The machine stayed awake; results are warm-cache, isolated-profile observations, not universal Mac timings.

| Endpoint | Lean v0.6 candidate median / p95 | Original Code-OSS median / p95 | Successful timed launches |
| --- | ---: | ---: | ---: |
| [Finder launch to first synthetic UI edit](../performance/v0.6.0-candidate-first-ui-edit-finder-vs-code-oss-1.139.1-minified.json), established profile | 982 / 1,054 ms | 1,205 / 1,641 ms | 30 / 30 each |
| [Extension-backed editable file](../performance/v0.6.0-candidate-extension-fresh-vs-code-oss-1.139.1-minified.json), fresh profile | 1,307 / 1,427 ms | 1,637 / 1,785 ms | 30 / 30 each |
| [First edit saved and verified on disk](../performance/v0.6.0-candidate-first-save-vs-code-oss-1.139.1-minified.json), fresh profile | 1,445 / 1,777 ms | 1,972 / 2,107 ms | 30 / 30 each |

The Finder first-edit median was about **19% sooner**, and the fresh-profile extension-backed editable file median about **20% sooner**. The save workflow completed about **527 ms / 27% sooner** at the median from process start. Its action-only median after startup was **92.5 ms for Lean versus 40.4 ms for Code-OSS**; the gain is in the full launch-to-save workflow, not faster editing itself. The Finder endpoint verifies synthetic text in Monaco through Chrome DevTools Protocol, not a physical keystroke or display paint. The extension-backed endpoint uses the same installed control VSIX in both apps and verifies a reversible edit probe.

The separate [established-profile extension-backed CLI run](../performance/v0.6.0-candidate-extension-established-vs-code-oss-1.139.1-minified.json) had one Code-OSS startup failure and an unusable Code-OSS existing-window phase. The [first-UI-edit CLI run](../performance/v0.6.0-candidate-first-ui-edit-cli-vs-code-oss-1.139.1-minified.json) had one Lean visibility timeout. Their raw failures are retained; neither run is used for a public speed headline. Three memory snapshots per product came from one launch in each extension-backed run. The GPU footprint varied sharply, so these observations cannot establish a repeatable v0.6 memory gain. The earlier nine-pair v0.4.0 result stays labeled as historical.

## Remaining release gates

Build from the final release commit, then verify the signed/notarized app, matching DMG and update ZIP, bundle size versus Code-OSS, signed-app GUI smoke, a normal Open VSX extension install, and the native v0.5.0 → v0.6.0 update. Confirm the final app includes the new light theme. Update the README and website with exact measured-version labels and the public GitHub release before marking this document released.

See the [changelog](../../CHANGELOG.md) for the release change list.
