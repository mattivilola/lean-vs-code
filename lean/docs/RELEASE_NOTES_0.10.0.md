# Lean VS Code v0.10.0 release notes

v0.10.0 keeps the focused editor, local Git review, terminal, search, and extension platform while moving four optional code paths out of the initial renderer graph. The built-in chat and agent UI remain absent. This routine minor release makes **no new startup-time or runtime-memory percentage claim**; the paired GUI comparison against original same-revision Code-OSS waits for a major release or an explicit owner request.

## Changes

- [Automatic chat-instruction collection](../performance/v0.10.0-automatic-instructions-lazy-cut.json) loads only when an extension-backed request supplies an instruction context and core collection is enabled. A canceled request exits after loading, and collection failures keep the existing empty-result fallback.
- [MCP request handling](../performance/v0.10.0-mcp-request-handler-lazy-cut.json) loads only after a server reaches Running. Connection state and cancellation are rechecked after loading and before accepting the handler, so stopping a server during the load cannot leave a handler active.
- The [tunnel address prefix](../performance/v0.10.0-tunnel-address-constant-cut.json) and [Copilot CLI assignment-context key](../performance/v0.10.0-copilot-context-constant-cut.json) now live in small modules. Their original exports remain for compatibility. The tunnel change saves only 144 unminified emitted bytes; it is recorded for completeness rather than presented as a meaningful standalone speed gain.

The v0.10.0 desktop initial static JavaScript graph contains **31,412,263 unminified bytes** versus **31,461,650** in v0.9.0, a **49,387-byte reduction**. The four source-change reports account for 49,388 bytes; the one-byte difference is the release-version change in the final candidate. This is code-loading evidence, not a measured launch-time or memory saving. The first eligible chat instruction request and first MCP connection now incur an asynchronous module load.

## Validation

Client compilation, changed-file lint, and `npm run lean:check-ai` passed, with zero missing service registrations and all 87 extension API actors present. Focused Node tests passed for ChatService (117), automatic instructions (65), MCP connection and stop/start behavior (17), and Copilot CLI configuration (6). A whole-ChatService async proxy was rejected in the [optimization ledger](OPTIMIZATION_LEDGER.md) because its synchronous model, event, reference, and persistence contracts need a larger design and test effort.

The production-minified Apple Silicon candidate was built from product commit `c4952a32041ef1640af75f557c3c6b804ee62c50` and reports Lean v0.10.0 with the Code-OSS 1.139.1 extension API. Release packaging, focused GUI checks, signing, notarization, app-bundle comparison, updater validation, and publication evidence are recorded below once completed.

The [source-app functional check](../performance/v0.10.0-source-functional-no-timing.json) passed edit/save, 401-file project search, 400-file text search, a terminal command, local Git diff, and a temporary extension webview in an isolated 560 × 360 bottom-left window. No GUI timings were collected. An initial sandboxed launch aborted before checks; the same candidate passed outside the sandbox, with no actor, dependency-injection, or renderer errors in its log.

## Publication and remaining checks

The sub-one-second p95 extension-backed editable-file target remains open until a signed matched Code-OSS comparison proves it. The last paired public speed result belongs to v0.6.0; no v0.10.0 startup or runtime-memory percentage is claimed. The owner's installed app is not modified by the release build.
