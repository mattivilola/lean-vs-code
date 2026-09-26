# Build and release on macOS

The first supported build target is macOS on Apple Silicon. The source is based on Code-OSS `1.139.1` and uses its extension API version. Lean VS Code's own release number is in [`lean/VERSION`](../VERSION).

## Build from source

Install Xcode command-line tools, Node.js `24.18.0` (see `.nvmrc`), and npm. From the repository root:

```sh
nvm use
npm ci
npm run gulp vscode-darwin-arm64
```

The app is written to `.build/lean-artifacts/LeanVSCode-darwin-arm64/Lean VS Code.app`. Run that app directly for local development. It uses its own bundle identifier and user-data directory, separate from Visual Studio Code. The build downloads Electron and compiles native dependencies; allow ample disk space. On a machine where the npm or Electron cache is restricted, point those caches to writable locations or adjust their permissions.

Open VSX signs complete VSIX packages with Ed25519, while Code-OSS's default `vsce-sign` verifier expects Microsoft's PKCS#7 signature format. Lean VS Code verifies Open VSX packages against the registry public key pinned in `extensionSignatureVerificationService.ts`. A future registry key rotation needs a new app release; failed verification must not be bypassed for a release test.

## Create the signed and notarized macOS release

The release script stages a copy of the built app, removes generated JavaScript source maps from that copy, verifies the exact bundled-extension allowlist and extension-signature verifier, applies Lean VS Code's macOS version, and signs the app and nested code with a Developer ID Application certificate. It submits a temporary ZIP to Apple, staples and verifies the app, then packages **that same notarized app** into an update ZIP and a drag-to-Applications DMG. It separately notarizes and staples the DMG, and emits the static Squirrel.Mac feed with the ZIP's SHA-256 and size. It never modifies the source app.

Store Apple notarization credentials in Keychain with `xcrun notarytool store-credentials`; never put the app-specific password in a script, repository, or shell history. For the maintainer's local profile, the name is `lean-vs-code`.

```sh
export CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)'
export NOTARY_KEYCHAIN_PROFILE='lean-vs-code'
node build/darwin/lean-release.mjs
```

The DMG, update ZIP, and `releases-darwin-arm64.json` are placed in `.build/lean-artifacts/releases/`. The script refuses to overwrite an existing DMG or ZIP. This command requires the `build` package dependencies installed by `npm ci` and a valid Developer ID identity and notarytool profile.

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

Before making the draft public, mount the DMG, copy the app to a test location, launch it, and verify a local file, Git change review, and installation of a test extension. The production feed's `releases/latest/download` URL becomes usable only after publication; promptly run a signed A-to-B update trial in an isolated profile against that live feed, and withdraw a broken release before advertising it. Record the exact fork commit, upstream commit, toolchain, extension inventory, artifact hashes, notarization result, test evidence, and known limitations in the GitHub release notes. v0.3.0 and earlier require a one-time manual upgrade because they did not contain an updater.
