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

## Create the signed DMG

The release script stages a copy of the built app, removes generated JavaScript source maps from that copy, verifies the exact bundled-extension allowlist and extension-signature verifier, applies Lean VS Code's macOS version, signs the app and nested code with a Developer ID Application certificate, verifies the signature, and creates a drag-to-Applications DMG. It never modifies the source app.

```sh
export CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)'
node build/darwin/lean-release.mjs
```

The DMG is placed in `.build/lean-artifacts/releases/`. The script refuses to overwrite an existing DMG. This command requires the `build` package dependencies installed by `npm ci`.

## Notarize and verify

Store Apple notarization credentials in Keychain with `xcrun notarytool store-credentials`; never put the app-specific password in a script, repository, or shell history. For the maintainer's local profile, the name is `lean-vs-code`.

```sh
release_version="$(cat lean/VERSION)"
release_dmg=".build/lean-artifacts/releases/Lean-VS-Code-${release_version}-macos-arm64.dmg"
xcrun notarytool submit "$release_dmg" --keychain-profile lean-vs-code --wait
xcrun stapler staple "$release_dmg"
xcrun stapler validate "$release_dmg"
shasum -a 256 "$release_dmg"
```

Before publishing, mount the DMG, copy the app to `/Applications`, launch it, and verify a local file, Git change review, and installation of a test extension. Record the exact fork commit, upstream commit, toolchain, extension inventory, artifact hash, notarization result, and known limitations in the GitHub release notes. App updates are not automatic; install future releases from GitHub Releases.
