# Lean VS Code v0.9.0 release notes — candidate

v0.9.0 keeps Lean VS Code's focused editor, local Git review, terminal, search, and extension platform while moving three optional compatibility paths out of the initial renderer graph. The built-in chat and agent UI remain absent. This minor release makes no new startup or runtime-memory percentage claim; the paired GUI comparison against original same-revision Code-OSS is reserved for a major release or an explicit owner request.

## Changes

- [Agent Merge request labels](../performance/v0.9.0-agent-merge-request-text-cut.json) no longer import the DOM widget from the initial request-text path. The original widget and compatibility exports remain.
- The [session hover widget](../performance/v0.9.0-session-hover-lazy-cut.json) loads only after a provider returns data; cancellation is checked after the import. First hover incurs this load.
- [Terminal command approval analysis](../performance/v0.9.0-terminal-approval-lazy-cut.json) loads its parser and rule evaluator on demand. Empty commands avoid analysis, and failed loading returns no approval suggestion while the confirmation prompt remains.

Together these cuts reduce the initial emitted static desktop JavaScript graph from 31,520,121 to 31,461,650 unminified bytes, a 58,471-byte reduction relative to v0.8.0. The linked reports give each contribution, focused checks, and method. This is source-build graph evidence only: no v0.9 GUI timing, memory, or Code-OSS size comparison has yet been measured.

## Validation and publication gates

Client typecheck, compile, changed-file lint, and `npm run lean:check-ai` passed, with zero missing service registrations and all 87 extension API actors present. Ten Agent Merge, three session-hover, and eight terminal-service focused headless Chromium tests passed.

Before publication, build the production-minified Apple Silicon app from the exact versioned commit; run the compact, no-timing functional and installed-extension checks; sign and notarize the app, updater ZIP, and DMG; verify package parity and Gatekeeper; measure its installed bundle against original same-revision Code-OSS; and publish the verified GitHub release and update feed. Then check the live feed and update path. Keep the v0.6 signed speed results historical until the owner requests a combined paired timing run.
