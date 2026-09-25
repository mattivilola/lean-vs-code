# Lean VS Code

![Lean VS Code retro emerald app icon](resources/branding/lean-code.png)

**Lean VS Code** is a free, open source fork of [Code - OSS](https://github.com/microsoft/vscode), the open source foundation of Visual Studio Code. It is being shaped into a quiet, fast editor for reading and editing code and reviewing local Git changes. The default experience avoids AI prompts and keeps optional features out of the way. Extensions remain part of the design.

The project is in **early development**. There is no tested public app release yet. The current source starts from upstream release `1.139.1`; the macOS Apple Silicon build and extension compatibility are being validated. See the [implementation plan](IMPLEMENTATION_PLAN.md) for the target behavior and measurable release gates. Current behavior can differ from that plan.

## What is changing

- Independent Lean VS Code identity, storage paths, and retro emerald app icon.
- Quiet first-run defaults, with AI features disabled and no bundled Copilot extension in the planned distribution.
- A deliberately smaller set of bundled syntax and theme extensions; optional extensions will be available through Open VSX or local VSIX files.
- Local Git review as the main feature beyond text editing, under active development.

The [bundled extension list](lean/bundled-extensions.json) defines what belongs in the first distribution. Some upstream services still need removal or deferred startup before the performance and privacy goals can be claimed.

## Source and branches

This repository is a GitHub fork of `microsoft/vscode`. Its product branch is `main`; the local `upstream` Git remote points to the original source. Upstream releases are incorporated deliberately after build, compatibility, and performance checks. The upstream source, its history, and required notices remain credited.

## Build status

The first test target is macOS on Apple Silicon. The upstream toolchain currently requires Node.js `24.18.0` or newer within major version 24, Xcode command-line tools, and npm. The local build is being verified; packaged app instructions and downloadable artifacts will be added when the build passes.

## Contributing

Issues and contributions are welcome in this repository. Please keep changes focused and preserve compatibility with Code-OSS where practical. The [upstream contribution guide](https://github.com/microsoft/vscode/wiki/How-to-Contribute) is useful for the underlying codebase.

## License

Lean VS Code remains free and open source under the [MIT license](LICENSE.txt), like Code-OSS. Original Microsoft and third-party copyright notices remain in the source and [third-party notices](ThirdPartyNotices.txt). Lean VS Code is an independent community fork and is not Microsoft's Visual Studio Code distribution.
