# Lean VS Code v0.6.0 — release candidate

**Status: release candidate, not released.** The changes below are implemented and pass functional checks. No v0.6.0 timing or memory result has been measured yet, so this document makes no speed or memory claim. The pending measurements are listed at the end; replace this status paragraph with measured results before publishing.

v0.6.0 focuses on the everyday way the editor is used: opening files from the terminal or Finder with a profile that has been used before, and reviewing local changes.

## What changed

- **Daytime theme.** Lean VS Code Light is bundled alongside the existing emerald dark palette. The Color Theme picker shows **Lean VS Code Light** and **Lean VS Code Dark**; existing dark-theme selections are preserved.
- **No built-in AI.** Chat, agent sessions, inline chat, the MCP management UI, voice, AI customization, and agent-host UI are no longer part of the desktop workbench. The upstream sources stay in the repository and only their imports are cut, which keeps upstream merges simple. Services that core upstream code still injects are registered from one Lean module (`src/vs/workbench/contrib/leanAi`). Every extension API remains available: `vscode.lm` reports no language models, MCP server definition providers can still register, and chat participant or tool registrations from installed extensions have no built-in UI to appear in.
- **Smaller renderer bundle.** The unminified desktop workbench bundle shrinks from 40.2 MB to 34.9 MB. The minified workbench JavaScript shrinks from 19.4 MB to 16.9 MB and its CSS from 1.69 MB to 1.43 MB (minified sizes measured before the final 0.13 MB actor restoration). A smaller bundle means less code to parse and fewer registered commands, views, and settings; its startup and memory effect is still to be measured.
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

## Pending before release

Run these on the reference Mac when it is otherwise idle, keep it awake (`caffeinate -dimsu`), and compare against the matched minified original Code-OSS 1.139.1 build at base revision `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`. Use 30 alternating pairs and retain failures. Build the candidate with `BUILD_SOURCEVERSION=$(git rev-parse HEAD) npm run gulp vscode-darwin-arm64-min` from the release commit first.

1. **Primary: daily-use first UI edit**, established profile, CLI and Finder launches:
   `node scripts/lean-perf/visible-file-benchmark.mjs --lean-app <candidate.app> --oss-app <code-oss.app> --base-revision 04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1 --samples 30 --input-probe --reuse-profile --launch-mode cli`, then the same with `--launch-mode finder`.
2. **Secondary: extension-backed editable file**, established profile, CLI launch: `node scripts/lean-perf/benchmark.mjs --lean-app <candidate.app> --oss-app <code-oss.app> --base-revision 04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1 --reuse-startup-profile --launch-mode cli`.
3. **Continuity with earlier releases:** the fresh-profile direct-launch run (`benchmark.mjs` defaults), so v0.6.0 can be compared with the v0.4.0 and v0.5.0 history.
4. **Memory:** the independent-launch short-idle method from v0.4.0, now with the per-process role breakdown (`byRole` in `summary.json`).
5. **Bundle size:** `node scripts/lean-perf/bundle-size.mjs` against the same Code-OSS package.
6. **Release closure** from [the optimization ledger](OPTIMIZATION_LEDGER.md) and [BUILDING.md](BUILDING.md): signing, notarization, DMG and update ZIP, GUI smoke of the signed app, an Open VSX install, and a live v0.5.0 → v0.6.0 update trial. Then update the README, changelog, and website with only the measured results.

See the [changelog](../../CHANGELOG.md) for the unreleased change list.
