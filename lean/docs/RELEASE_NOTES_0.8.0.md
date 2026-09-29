# Lean VS Code v0.8.0 release notes — source candidate

**Not released.** The public signed and installed version remains v0.7.0. These notes track the v0.8 source candidate and must be finalized from the exact tested, signed release commit before publication.

The candidate keeps editing, local Git review, terminal, search, and the extension API while moving optional chat and paste code out of the initial desktop renderer graph. It does not yet have a signed Code-OSS startup comparison, so no new startup, memory, disk-size, or yearly-time-saving percentage is claimed.

## Candidate changes

- Load the optional Quick Chat renderer on first use through a synchronous-service-compatible proxy. Six focused headless proxy tests passed; the real first-use UI remains to be checked.
- Keep terminal chat attachment code, the optional chat-pet renderer, and image hashing from pulling broader chat UI or paste-provider modules into the initial graph. The [ledger](OPTIMIZATION_LEDGER.md) and linked static-graph reports record each cut, its validation, and the rejected experiments. The latest desktop initial static graph is 31,520,121 unminified JavaScript bytes. This is a parse-work opportunity, not a measured startup saving.
- Preserve the registered services and all 87 extension API actors. `npm run lean:check-ai` passed with zero missing dependency registrations.

## Validation so far

- Client typecheck and changed-file lint passed. Focused tests passed for the Quick Chat proxy (six headless Chromium cases), pet-host coordination (five), image hashing (Node known vectors and offset view), and paste providers (five headless Chromium cases).
- A production-minified Apple Silicon app build completed from source commit `f4d57144d96369f051db288ab2e279794946cb86`. Its package contains 33 curated bundled-extension directories, no separate `out/vs/sessions` bundle, and the expected Lean bundle identifier. This **local build is unsigned**, still carries the upstream `1.139.1` package version before release staging, and is not an installable v0.8 release.
- An [isolated functional-only check](../performance/v0.8.0-source-functional-smoke-no-timing.json) on an ad-hoc-signed copy of that build passed edit/save, project and text search, terminal output, local Git diff, and a temporary extension webview. The app used a 560 × 360 bottom-left window. No startup or per-check timing was collected; this does not validate an installed Open VSX extension or a signed release.
- A separate [Open VSX functional check](../performance/v0.8.0-source-editorconfig-functional-no-timing.json) installed EditorConfig 0.18.2 into an isolated profile. Signature verification succeeded, the extension activated, and its output log shows it processed `src/main.ts`. This was also a compact-window, no-timing run on the source candidate, not the final signed app.
- An earlier three-pair fresh-profile diagnostic of the Quick Chat split versus installed v0.7.0 was mixed and is recorded in the [candidate report](../performance/v0.8.0-cold-renderer-split-candidate.json). It cannot support a speed claim for this later source candidate or against Code-OSS. The owner has deferred further GUI timing until requesting a combined test.

## Required before publication

Verify the changed optional first-use paths, then repeat representative core and installed-extension checks on the exact final signed candidate. Check first-use Quick Chat, chat-pet host switching, terminal attach-to-chat, pasted images, and extension image attachments where those paths remain reachable. Then bump the Lean release version, rebuild, sign and notarize the app, DMG and updater ZIP; verify archive identity, install, and applicable A-to-B update behavior. Finalize the changelog, README, and website with version-labeled facts and links to the published release. The sub-one-second p95 editable-file target remains open until a signed matched comparison proves it.
