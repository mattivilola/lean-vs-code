# Lean VS Code v0.10.0 release notes

v0.10.0 keeps the focused editor, local Git review, terminal, search, and extension platform while moving four optional code paths out of the initial renderer graph. The built-in chat and agent UI remain absent. The owner explicitly requested a combined paired GUI benchmark for this minor release. In 30 alternating fresh-profile launches, the signed app reached an extension-editable file **23% sooner at the median** than original same-revision Code-OSS. The sub-one-second p95 target remains open.

## Changes

- [Automatic chat-instruction collection](../performance/v0.10.0-automatic-instructions-lazy-cut.json) loads only when an extension-backed request supplies an instruction context and core collection is enabled. A canceled request exits after loading, and collection failures keep the existing empty-result fallback.
- [MCP request handling](../performance/v0.10.0-mcp-request-handler-lazy-cut.json) loads only after a server reaches Running. Connection state and cancellation are rechecked after loading and before accepting the handler, so stopping a server during the load cannot leave a handler active.
- The [tunnel address prefix](../performance/v0.10.0-tunnel-address-constant-cut.json) and [Copilot CLI assignment-context key](../performance/v0.10.0-copilot-context-constant-cut.json) now live in small modules. Their original exports remain for compatibility. The tunnel change saves only 144 unminified emitted bytes; it is recorded for completeness rather than presented as a meaningful standalone speed gain.

The v0.10.0 desktop initial static JavaScript graph contains **31,412,263 unminified bytes** versus **31,461,650** in v0.9.0, a **49,387-byte reduction**. The four source-change reports account for 49,388 bytes; the one-byte difference is the release-version change in the final candidate. This is code-loading evidence, not a measured launch-time or memory saving. The first eligible chat instruction request and first MCP connection now incur an asynchronous module load.

## Validation

Client compilation, changed-file lint, and `npm run lean:check-ai` passed, with zero missing service registrations and all 87 extension API actors present. Focused Node 24.21.0 tests passed for ChatService (117), automatic instructions (65), MCP connection and stop/start behavior (17), and Copilot CLI configuration (6). A whole-ChatService async proxy was rejected in the [optimization ledger](OPTIMIZATION_LEDGER.md) because its synchronous model, event, reference, and persistence contracts need a larger design and test effort.

The production-minified Apple Silicon candidate was built from product commit `c4952a32041ef1640af75f557c3c6b804ee62c50` on the fork's Code-OSS base `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`. It reports Lean v0.10.0 with the Code-OSS 1.139.1 extension API and bundles 33 extensions. Packaging ran on macOS 27.0 with Xcode 27.0. The release script signed and notarized the app, updater ZIP, and DMG; its deep strict signature, stapling, and Gatekeeper checks passed. The ZIP and mounted DMG apps contain 2,219 matching filesystem entries, with no content or symlink-target differences in a checksum comparison. Both app copies passed independent deep strict signature verification. The release ZIP is 192,342,908 bytes with SHA-256 `e75af3f736b34a452ad49484ee1f36c99d64e018101924d3f91b9cbf07b221de`; the generated update feed advertises that exact size and hash. The DMG is 205,098,377 bytes with SHA-256 `7886a3b6a30c2bfe259db40968f6b2e979601d753dc966f4ce1633ad3eab17b5`.

The [source-app functional check](../performance/v0.10.0-source-functional-no-timing.json) passed edit/save, 401-file project search, 400-file text search, a terminal command, local Git diff, and a temporary extension webview in an isolated 560 × 360 bottom-left window. No GUI timings were collected. An initial sandboxed launch aborted before checks; the same candidate passed outside the sandbox, with no actor, dependency-injection, or renderer errors in its log.

The [signed-release functional check](../performance/v0.10.0-release-functional-no-timing.json) passed the same workflows plus installation and activation of Open VSX EditorConfig 0.18.2 in a separate profile. A fresh app copied from the mounted DMG independently passed all seven checks. The earlier ZIP-app check timed out when the Mac slept between test invocation and app start; a later one-pair startup setup check and the full functional rerun succeeded. Its logs contain no actor, dependency-injection, or renderer errors. No speed or memory result is inferred from these functional checks.

The [packaged-app size comparison](../performance/v0.10.0-bundle-size-vs-code-oss-1.139.1-minified.json) found **514 versus 1,463 MiB** of apparent app content, or **64.9% smaller**, against original same-revision minified Code-OSS. This includes the smaller curated built-in extension set and omitted generated assets. It is a disk-bundle comparison, not a runtime-memory or download-size claim. The v0.10 bundle is not meaningfully smaller than v0.9; this percentage is versus Code-OSS.

## Paired GUI result

The [30-pair signed-app comparison](../performance/v0.10.0-vs-code-oss-1.139.1-minified.json) used the same Apple M3 Max, 560 × 360 window, 100 KiB fixture, isolated fresh profiles, and installed control-extension VSIX for both apps. Both were minified builds from the same Code-OSS base revision. The complete run had no failed samples.

| Workflow | Signed Lean v0.10.0 median / p95 | Original Code-OSS median / p95 | Result |
| --- | ---: | ---: | --- |
| Stopped app to extension-editable requested file | 1.471 / 1.596 s | 1.903 / 2.141 s | 23% less median time; 25% less p95 |
| Open another file in an existing window | 416 / 437 ms | 403 / 550 ms | Lean median 3% slower; p95 21% lower |

The startup endpoint requires the requested editor to accept a reversible edit through an installed extension API; it does not measure physical screen paint. The existing-window median regression is retained in the result rather than counted as a gain.

The [nine-pair independent short-idle memory trial](../performance/v0.10.0-independent-memory-vs-code-oss-1.139.1-minified.json) used a fresh isolated launch and one snapshot after 30 seconds idle per app in each pair. Median summed macOS process footprints were **395 MiB for Lean versus 524 MiB for Code-OSS** (25% lower by difference of medians). Lean was lower in **6 of 9** pairs; the other 3 favored Code-OSS. Both apps' GPU processes switched between low and high footprint modes, and a one-launch snapshot in the main run favored Code-OSS. These data show a promising lower median under the test conditions, but not a stable per-launch or long-session memory saving. The public website keeps the stronger historical v0.4 memory headline labeled with that version and links to these raw v0.10 observations.

## Publication and remaining checks

The sub-one-second p95 extension-backed editable-file target remains open at 1.596 seconds in this signed matched-build run. The owner's installed app is not modified by the release build; its native v0.9-to-v0.10 updater trial will be checked after publication.
