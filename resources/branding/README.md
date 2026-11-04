# Approved Lean CRT family

Matti selected option 01 on 4 November 2026: **teal CRT with mint braces for Lean VS Code**, emerald CRT terminal prompt for sibling Lean Term. These are different product marks. Theme colors and generic language/file icons remain independent of the product icon.

`crt-family/` contains the frozen editor asset exports. The full upstream manifest is `crt-family-manifest.json`, verified SHA-256 `18a7151b799295c67a73fecc146b4e8f2dba5ddf962e56eb5947787fbc907b6a`. Its `lean-vs-code/` keys correspond to files under this directory's `crt-family/`. Every file in the original 70-file editor/terminal pack was verified before copying. The pack originates from the sibling project's approved `branding/approved/crt-family/` handoff; it requires no font or image-generation service at build time.

| Active surface | Approved source |
| --- | --- |
| macOS `resources/darwin/code.icns` | `LeanVSCode.icns`, exact bytes |
| README `lean-code.png` | `app-icon-1024.png`, exact bytes |
| Linux app icon | `icon-512.png`, exact bytes |
| Server/PWA icons and favicon | `icon-192.png`, `icon-512.png`, `favicon.ico`, exact bytes |
| Workbench product watermark | `symbol.svg`, exact vector bytes |
| Windows app ICO | Container of unchanged approved 16/32/48/64/128/256 PNG frames |
| Windows 70/150 tiles | Native `sips` size derivatives of approved 128/180 PNGs |
| Website | Approved light/dark wordmarks, favicon/touch/manifest assets and sibling icon |

Do not replace generic document/language icons or third-party service logos. Keep the bundle identifier, settings/storage directories, updater identity and unnumbered app name. Rebuild and sign the app; never patch an installed signed app's resources. The release script verifies the staged and notarized app icon against this manifest before publishing its archives.
