# Lean VS Code v0.9.0 release notes

v0.9.0 keeps Lean VS Code's focused editor, local Git review, terminal, search, and extension platform while moving three optional compatibility paths out of the initial renderer graph. The built-in chat and agent UI remain absent. This minor release makes no new startup or runtime-memory percentage claim; the paired GUI comparison against original same-revision Code-OSS is reserved for a major release or an explicit owner request.

## Changes

- [Agent Merge request labels](../performance/v0.9.0-agent-merge-request-text-cut.json) no longer import the DOM widget from the initial request-text path. The original widget and compatibility exports remain.
- The [session hover widget](../performance/v0.9.0-session-hover-lazy-cut.json) loads only after a provider returns data; cancellation is checked after the import. First hover incurs this load.
- [Terminal command approval analysis](../performance/v0.9.0-terminal-approval-lazy-cut.json) loads its parser and rule evaluator on demand. Empty commands avoid analysis, and failed loading returns no approval suggestion while the confirmation prompt remains.

Together these cuts reduce the initial emitted static desktop JavaScript graph from 31,520,121 to 31,461,650 unminified bytes, a 58,471-byte reduction relative to v0.8.0. The linked reports give each contribution, focused checks, and method. This is source-build graph evidence only: no v0.9 GUI timing or runtime-memory comparison was measured.

The signed v0.9.0 app has **64.9% less apparent file content** than the preserved, locally repaired original Code-OSS 1.139.1 minified source package at the same upstream revision: 514 versus 1,463 MiB. See the [v0.9.0 bundle-size report](../performance/v0.9.0-bundle-size-vs-code-oss-1.139.1-minified.json). This is installed app-bundle disk content, not download size or process memory.

## Validation

Client typecheck, compile, changed-file lint, and `npm run lean:check-ai` passed, with zero missing service registrations and all 87 extension API actors present. Ten Agent Merge, three session-hover, and eight terminal-service focused headless Chromium tests passed.

The production-minified Apple Silicon app was built from product commit `9d675a0402f065ad9ed92e3dd2d9e4a7146e614a` with Node 26.9.0 and npm 11.19.1. It reports Lean v0.9.0 and Code-OSS extension API 1.139.1, contains 33 curated bundled-extension directories, and omits the separate Agents-window bundle.

An isolated [source-app functional check](../performance/v0.9.0-source-functional-no-timing.json) passed edit/save, 401-file project search, 400-file text search, a terminal command, local Git diff, and a temporary extension webview. The [final signed updater app](../performance/v0.9.0-release-functional-no-timing.json) passed those six checks again and installed Open VSX EditorConfig 0.18.2 into an isolated profile. Ed25519 verification succeeded; the extension activated and processed `src/main.ts`. Both checks used a 560 × 360 bottom-left window and collected no GUI timings. A macOS certificate-parsing message and Node `url.parse()` deprecation warning appeared without failing the checks.

The updater ZIP and mounted DMG contained 2,209 matching app entries, with no file or symlink differences. Deep strict code-signature verification passed on the extracted ZIP app. The release script validated both stapled tickets and Gatekeeper acceptance. The ZIP is 192,328,931 bytes with SHA-256 `70e8ff1ecc4791c8d6e47a23f94d680d4c6243fcc1de19c4187b6a522241e582`; the DMG is 204,024,669 bytes with SHA-256 `204c147bb3b706bec8d9dd234c5bf4990cf721ebaef82b4d2b40beb6e817fb85`. The generated update feed matches the ZIP hash and size.

## Publication and remaining checks

The signed release is ready for publication on GitHub. The live latest-release feed and native update path can be verified only after publication. The owner's installed app is not modified by this build. The sub-one-second p95 extension-backed editable-file target remains open until a signed matched Code-OSS comparison proves it; the last paired speed results remain version-labeled as v0.6.0.
