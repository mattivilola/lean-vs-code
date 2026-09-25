# Lean VS Code v0.2.0

The first Apple Silicon release of Lean VS Code: a quiet, independent Code-OSS fork for editing code and reviewing local Git changes.

- Emerald branding, separate app identity and storage, and a visible Lean release number alongside the Code-OSS extension API version.
- Local Git changes and side-by-side diff review work out of the box.
- 33 curated built-in extensions for syntax, themes, and Git; optional extensions are available through Open VSX or a local VSIX.
- Default telemetry, experiments, update checks, extension recommendations, onboarding, and built-in AI surfaces are turned off.
- The release app omits generated JavaScript source maps, reducing uncompressed disk usage by about 227 MiB without claiming a runtime-memory improvement.
- Signed and notarized DMG for macOS on Apple Silicon; drag the app into Applications. No automatic app updater in this version.

Lean VS Code is based on Code-OSS 1.139.1 and uses that extension API version. This is an early release. Extensions that depend on Microsoft services, proposed APIs, or removed built-in AI providers may require testing or may not work. Optional extensions can add their own processes and network requests. Startup and idle-memory targets are not yet benchmarked.
