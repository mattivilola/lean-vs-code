# Build and release on macOS

The first supported build target is macOS on Apple Silicon. The source is based on Code-OSS `1.139.1` and uses its extension API version. Lean VS Code's own release number is in [`lean/VERSION`](../VERSION).

## Build from source

Install Xcode command-line tools, Node.js `24.18.0` (see `.nvmrc`), and npm. From the repository root:

```sh
nvm use
npm ci
npm run gulp vscode-darwin-arm64
```

The app is written to `.build/lean-artifacts/LeanVSCode-darwin-arm64/Lean VS Code.app`. Run that app directly for local development. It uses its own bundle identifier and user-data directory, separate from Visual Studio Code. Development bundles declare document roles as `None` and do not claim the `lean-code://` URL scheme, so launching builds does not add file handlers to Finder's **Open With** menu. The release script restores those associations in its staged copy before signing. The build downloads Electron and compiles native dependencies; allow ample disk space. On a machine where the npm or Electron cache is restricted, point those caches to writable locations or adjust their permissions.

## Keep one installed app and Finder entry

### Updated app still shows its previous Dock icon

Check the installed version first. On the maintainer's Mac, v0.10.1 contained the exact approved teal ICNS, but macOS's icon service still returned the earlier emerald artwork even after restarting the Dock. The app folder retained Electron's 1 January 1980 modification timestamp. Refreshing only that folder timestamp made `NSWorkspace.icon(forFile:)` return the new icon; a fresh editor launch also returned it through `NSRunningApplication.icon`. Strict signature verification passed before and after; signed resources and user settings were unchanged.

With the editor closed, a targeted refresh is:

```sh
touch "/Applications/Lean VS Code.app"
killall Dock
open "/Applications/Lean VS Code.app"
```

This changes directory metadata, not the icon file or signed app contents. It does not delete global caches or reset Dock preferences. Starting with v0.10.2, `lean-release.mjs` refreshes the staged app folder's timestamp after stapling, before its final signature/Gatekeeper checks and ZIP/DMG packaging. If the pinned item still displays the old icon, quit Lean VS Code, remove its Dock shortcut, and drag the app from Applications back into the Dock. This final step resolved the stale shortcut on the maintainer’s Mac. Existing v0.10.1 release archives remain unchanged. The observed repair is recorded in [`v0.10.1-icon-refresh.json`](../performance/v0.10.1-icon-refresh.json).

### Preserve the canonical installation

Always install or replace `/Applications/Lean VS Code.app`. Keep the app name unversioned; versions belong in bundle metadata, DMG/ZIP filenames, and release notes. Do not install version-named copies or leave extracted verification apps in Applications. macOS remembers apps launched from build, test, and temporary directories, and adds version suffixes when several registered copies can handle the same file. The release script unregisters its staging copies in `finally`; the shared performance launcher and functional smoke harness unregister their test copies on cleanup while preserving the canonical installation.

After manual signed-app/update trials or to clean registrations from older builds, preview and then apply the targeted cleanup from a terminal with access to the macOS Launch Services database:

```sh
node build/darwin/lean-registration.mjs
node build/darwin/lean-registration.mjs --apply
```

This keeps `/Applications/Lean VS Code.app`, unregisters only other primary bundles with the exact Lean VS Code bundle identifier, and verifies that one registration remains. It does not delete app copies, modify signatures, reset file defaults, or rebuild the global database. Close and reopen Finder's context menu after cleanup. Retained signed release copies can register again if manually launched; run this cleanup after those trials. Keep historical releases archived as ZIP/DMG files rather than installed bundles.

For a release candidate, build with `npm run gulp vscode-darwin-arm64-min`. In a Git worktree, set `BUILD_SOURCEVERSION` to the exact 40-character `git rev-parse HEAD` value for that build; the upstream packaging helper reads `.git/HEAD` directly and otherwise omits commit metadata from worktree bundles. This uses the production minification and private-field conversion pipeline and writes to the **same app path**, replacing the previous local build. Run `npm run lean:check-ai` before building a candidate: it bundles the desktop workbench and fails if built-in AI modules outside `build/lean/aiBundleAllowlist.json` return after an upstream merge, if a bundled module injects an unregistered service, or if an extension-host protocol actor is missing. Update the allowlist only after reviewing why a module became reachable. Benchmark and test that exact candidate before signing it; a normal `vscode-darwin-arm64` build is useful for development but is not the optimized release bundle.

Open VSX signs complete VSIX packages with Ed25519, while Code-OSS's default `vsce-sign` verifier expects Microsoft's PKCS#7 signature format. Lean VS Code verifies Open VSX packages against the registry public key pinned in `extensionSignatureVerificationService.ts`. A future registry key rotation needs a new app release; failed verification must not be bypassed for a release test.

## Create the signed and notarized macOS release

The release script stages a copy of the tested **minified** app, removes generated JavaScript source maps from that copy, verifies the exact bundled-extension allowlist and extension-signature verifier, applies Lean VS Code's macOS version, and signs the app and nested code with a Developer ID Application certificate. It submits a temporary ZIP to Apple, staples and verifies the app, then packages **that same notarized app** into an update ZIP and a drag-to-Applications DMG. It separately notarizes and staples the DMG, and emits the static Squirrel.Mac feed with the ZIP's SHA-256 and size. It never modifies the source app.

Store Apple notarization credentials in Keychain with `xcrun notarytool store-credentials`; never put the app-specific password in a script, repository, or shell history. For the maintainer's local profile, the name is `lean-vs-code`.

```sh
export CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)'
export NOTARY_KEYCHAIN_PROFILE='lean-vs-code'
node build/darwin/lean-release.mjs
```

The DMG, update ZIP, and `releases-darwin-arm64.json` are placed in `.build/lean-artifacts/releases/`. The script refuses to overwrite an existing DMG or ZIP. This command requires the `build` package dependencies installed by `npm ci` and a valid Developer ID identity and notarytool profile.

If Apple's S3 Transfer Acceleration upload fails with a connection timeout, inspect the exact submission with `xcrun notarytool info <id> --keychain-profile lean-vs-code` before retrying. Set `NOTARY_DISABLE_S3_ACCELERATION=1` for a bounded retry through the normal upload endpoint. This changes upload routing only; signing, notarization and Gatekeeper checks remain required. The script prints the accepted submission IDs. On failure, it retains its task-owned temporary stage for diagnosis or recovery; it unregisters staged apps but does not publish incomplete artifacts. A live Apple processing job should be awaited using its existing ID, rather than resubmitted because observation timed out.

## Verify and publish

Before publication, extract both archives and confirm the same bundle version, bundle ID, and signed app content. Check the update ZIP's hash and size against the JSON feed. Confirm Apple notarization and Gatekeeper acceptance on the app and DMG. Release only stable numeric versions such as `0.3.2`; the stable feed must never point to a prerelease.

```sh
release_version="$(cat lean/VERSION)"
release_dmg=".build/lean-artifacts/releases/Lean-VS-Code-${release_version}-macos-arm64.dmg"
release_zip=".build/lean-artifacts/releases/Lean-VS-Code-${release_version}-macos-arm64.zip"
xcrun stapler validate "$release_dmg"
shasum -a 256 "$release_dmg"
shasum -a 256 "$release_zip"
```

Before tagging, move the completed `Unreleased` notes into a versioned entry in [`CHANGELOG.md`](../../CHANGELOG.md), link the detailed release notes, and update the README and website with only measured or verified claims for this version. Keep withdrawn candidates documented. Create a GitHub release draft at the verified source commit and upload the DMG, ZIP, and feed JSON. Confirm all three assets and their hashes before publishing the release; this makes the new feed available through `releases/latest/download/releases-darwin-arm64.json` only when the complete stable release is public. Verify the live feed and update ZIP URLs afterward. Keep prior release assets available for manual recovery. The macOS updater uses Electron's Squirrel.Mac static JSON mode, checks the GitHub feed after startup and periodically, and downloads a verified ZIP only for a newer version. A downloaded update installs on a normal app quit or through **Restart to Update**. `update.mode` can disable future checks, but Squirrel may still apply an update that was already staged.

Run the full paired GUI benchmark against original same-revision Code-OSS only for a major release or when the owner explicitly requests it. Minor and patch releases use focused checks for changed paths. Keep past speed and memory figures labeled with the exact measured version rather than implying they describe the new build; do not add a new version's speed or memory claim without its own matched evidence. A direct packaged-bundle size comparison may be recorded separately. Every release still needs the applicable functional, extension, signing, notarization, packaging, and update checks.

Before making the draft public, mount the DMG, copy the app to a test location, launch it, and verify a local file, Git change review, and installation of a test extension. The production feed's `releases/latest/download` URL becomes usable only after publication; promptly run a signed A-to-B update trial against that live feed, and withdraw a broken release before advertising it. Close other running app copies with the same bundle identifier before a copied-app trial: Squirrel.Mac uses shared ShipIt state per bundle ID, and a concurrent installed copy can redirect the target. Verify the actual bundle that was replaced. Record the exact fork commit, upstream commit, toolchain, extension inventory, artifact hashes, notarization result, test evidence, and known limitations in the GitHub release notes. v0.3.0 and earlier require a one-time manual upgrade because they did not contain an updater.
