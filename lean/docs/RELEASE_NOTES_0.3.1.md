# Lean VS Code v0.3.1 — withdrawn candidate

This candidate was briefly visible on GitHub on 2026-09-26, then returned to draft after a native update trial found that the packaged app still identified itself as upstream Code-OSS 1.139.1 to Electron. A signed test app with macOS bundle version 0.3.0 checked the v0.3.1 feed but reported no update. Changing the test app's packaged `package.json` version to 0.3.0 changed Electron's result to an available download, exposing the version mismatch.

**Do not use v0.3.1 as the auto-update release.** The corrected release is v0.3.2. Install its DMG once by hand if you use v0.3.0 or obtained this withdrawn candidate. The stable feed did not remain on v0.3.1. The draft and its original tag are retained as an audit trail; published tags and artifact bytes are not rewritten.

The updater implementation, Code-OSS 1.139.1 extension API, and prior [v0.3.0 performance comparison](PERFORMANCE.md) remain the basis of the corrected release. This candidate's earlier notarization and extension checks did not establish that native updates worked.
