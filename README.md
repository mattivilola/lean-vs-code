# Lean VS Code

![Lean VS Code emerald icon](resources/branding/lean-code.png)

**A quieter Code-OSS editor for writing code and reviewing local changes.** Lean VS Code is a free, open-source fork of [Code - OSS](https://github.com/microsoft/vscode). It keeps the familiar editor, search, terminal, Git diff view, and extension platform, while shipping with a smaller set of built-in extensions and fewer unsolicited surfaces. It has its own app identity and data directory, so it can live beside Visual Studio Code.

## Get v0.4.0

The current release supports **Apple Silicon Macs**. Download the signed and notarized [v0.4.0 DMG](https://github.com/mattivilola/lean-vs-code/releases/tag/v0.4.0), open it, and drag **Lean VS Code** into **Applications**. Launch it from Applications and open a file or folder. It does not replace your existing VS Code installation or import its extensions automatically. The v0.3.2 app supports automatic updates; v0.3.0 and the withdrawn v0.3.1 candidate need one manual install of v0.3.2 or newer to enable them.

Starting with v0.3.2, the macOS app checks its **GitHub stable-release feed** after startup and periodically while running. It downloads an update ZIP containing the signed and notarized app when a newer release is available and offers **Restart to Update**; a staged update can also install on normal quit. Choose `update.mode` in Settings to use automatic, startup-only, manual, or no future checks. Previously staged updates may still apply after checks are disabled. Initial installs remain available as DMGs on the [Releases page](https://github.com/mattivilola/lean-vs-code/releases).

See the [changelog](CHANGELOG.md) for what changed in each release, including the withdrawn v0.3.1 candidate. For a source build and the maintainer's signing/notarization procedure, see [Build and release on macOS](lean/docs/BUILDING.md).

## Why this fork exists

On our Apple M3 Max reference Mac, the signed v0.4.0 release reached an **editable file 17% sooner than the original, same-revision Code-OSS source build** in a 30-pair GUI run with **both apps minified**: **1.421 s versus 1.715 s median**, and **1.483 s versus 1.776 s p95**. The measured 0.295-second median difference would add up to roughly **5.75 hours across 70,276 file opens** if every open started a fresh app; that is an illustration, not observed annual time saved. The Code-OSS app was a locally repaired source build, not the official VS Code distribution. These warm-cache, isolated-profile 100 KiB file results are reference-machine measurements, not promises for every Mac or project. See the [method, raw observations, and internal version history](lean/docs/PERFORMANCE.md).

Lean is also **63.2% smaller as an installed app bundle** than the matched, locally built original Code-OSS source package on this Mac: **538 versus 1,463 MiB** of apparent file content. The [size report](lean/performance/v0.4.0-bundle-size-vs-code-oss-1.139.1-minified.json) includes the method and breakdown; both apps were minified, and the Code-OSS package retained more bundled extensions and generated source maps. The signed v0.4.0 Apple Silicon DMG is **206.8 MB**. No matched Code-OSS DMG was measured, so this is an absolute download size, not a download-size saving. Bundle size does not establish lower runtime memory or the space used by extensions installed later.

In a separate [nine-pair independent-launch memory trial](lean/performance/v0.4.0-independent-memory-vs-code-oss-1.139.1-minified.json), signed v0.4.0 used **655 MiB median short-idle app-tree footprint** versus **786 MiB** for original minified Code-OSS: **16.7% less** in this 100 KiB isolated-profile workload. Lean was lower in all nine pairs, with product order alternated and no sleep during the continuous measurement window. The method sums macOS `phys_footprint` across observed app processes after 30 seconds idle; it is not peak memory, long-session behavior, or a promise for an extension-heavy workspace. Earlier one-launch snapshots varied substantially, so the claim is limited to this repeated short-idle comparison.

With each app's isolated profile **reused after warm-up**, a separate 30-pair stopped-process run found a smaller **3% median file-ready gain**: **1.413 s versus 1.461 s**, with p95 **1.460 s versus 1.502 s**. This more established-profile condition must not be mixed with the fresh-profile 17% result. The [raw paired observations](lean/performance/v0.4.0-persistent-profile-vs-code-oss-1.139.1-minified.json) include all 30 launches per product.

A separate [visible-file diagnostic](lean/performance/v0.4.0-visible-file-vs-code-oss-1.139.1-minified.json) found the requested text in the editor DOM at **0.999 s versus 1.115 s median** for Lean and original minified Code-OSS; p95 was **1.073 s versus 1.134 s**. This same-instrumentation test suggests earlier visible content, but it does not verify physical display paint or editing readiness. The primary editable-file p95 target of under one second remains open.

A separate [first UI edit diagnostic](lean/performance/v0.4.0-first-ui-edit-vs-code-oss-1.139.1-minified.json) sent synthetic text to Monaco's native EditContext and verified that the requested editor visibly changed. Signed Lean v0.4.0 reached that result in **1.203 s versus 1.334 s median** for original minified Code-OSS, about **10% less time**; p95 was **1.248 s versus 1.368 s**. All 60 launches passed. This measures a usable UI edit through remote-debugging instrumentation, not a physical keystroke, save to disk, or extension-host API readiness.

In a separate [30-pair second-project-window diagnostic](lean/performance/v0.4.0-second-project-window-vs-code-oss-1.139.1-minified.json), the first project was already open before timing began. Lean opened a distinct project-folder window and accepted a visible synthetic edit in **0.901 s median / 1.147 s p95**, versus **1.177 / 1.348 s** for original minified Code-OSS: **23% less median time**. Lean was faster in all 30 pairs. This measures a second window in an already-running app, not stopped-process startup, a physical keystroke, or a saved edit.

A separate [30-pair repository-opening trial](lean/performance/v0.4.0-git-workspace-vs-code-oss-1.139.1-minified.json) used a 10,000-file Git fixture. Lean reached the editable file in **1.482 s versus 1.827 s median**, about **19% less time** than the same-revision, minified Code-OSS source build; p95 was **1.687 s versus 2.180 s**. This is a repository workload, so its numbers are kept separate from the standalone-file result.

A third [30-pair Git-review workflow trial](lean/performance/v0.4.0-git-review-vs-code-oss-1.139.1-minified.json) measured from a stopped app until its Git extension returned the local diff for the active file. Lean completed that workflow in **1.497 s versus 1.906 s median**, about **21% less time** than minified original Code-OSS; p95 was **1.672 s versus 2.105 s**. The Git action itself took longer after startup in Lean (**135 versus 56 ms median**), so this is a full launch-to-workflow gain, not a faster Git operation. The endpoint is a returned diff, not a painted diff editor.

In a [30-pair first saved-edit trial](lean/performance/v0.4.0-edit-save-vs-code-oss-1.139.1-minified.json), signed v0.4.0 inserted text into the requested file, saved it, and verified the bytes on disk in **1.425 s versus 1.901 s median** from a stopped app—**25% less time** than the same-revision, minified Code-OSS source build. P95 was **1.693 s versus 1.946 s**. The edit action by itself had a slower p95 in Lean (**85 versus 81 ms**), so the claim is about the full launch-to-save workflow. The test used an isolated one-file Git fixture, not a large project.

In a [30-pair integrated-terminal trial](lean/performance/v0.4.0-terminal-vs-code-oss-1.139.1-minified.json), the first shell command wrote a result verified on disk in **3.116 s versus 3.598 s median** from a stopped app—**13% less time** than original, same-revision minified Code-OSS. P95 was **3.262 s versus 3.701 s**. All 60 runs passed with macOS sleep prevented. The shell-command action alone was **1.906 s versus 1.975 s median**; the full result includes app startup and extension activation. It does not measure when the terminal prompt first paints.

A [30-pair workspace text-search trial](lean/performance/v0.4.0-workspace-search-vs-code-oss-1.139.1-minified.json) verified 10 expected matches among 400 source files. From a stopped app, Lean finished in **1.242 s versus 1.665 s median**—**25% less time** than original, same-revision minified Code-OSS; p95 was **1.288 s versus 1.759 s**. All 60 runs passed. The search action alone was **29 versus 36 ms median**. Both apps used the same proposed text-search API in a temporary control extension, so this is a verified-result comparison, not a Search-panel paint measurement.

v0.4.0 ships an optimized macOS bundle, removes synchronous remote-listener work from the editor's startup path, and begins the shared utility process's normal initialization once a real window opens. The workbench still registers its commands and extension APIs at startup. The paired result measures the whole fork against Code-OSS; it does not assign the 17% difference to any one change. We kept the changes that improved file-ready timing and set aside an extension-index experiment that did not.

Our [startup roadmap](lean/docs/STARTUP_ROADMAP.md) ranks the next measured experiments toward an editable file in under one second, including Apple Silicon and Electron work. It preserves extension compatibility as a release gate.

The [optimization ledger](lean/docs/OPTIMIZATION_LEDGER.md) records what shipped, what was tried and rejected, the evidence behind each decision, and the next use cases to test. It also defines the final release-summary checklist, so proposed gains stay separate from measured Code-OSS results.

The [developer workflow benchmark matrix](lean/docs/BENCHMARK_MATRIX.md) defines the tasks and completion events we will test next. Public speed claims compare Lean with the original, same-revision Code-OSS source build; Lean-version comparisons are retained only for development history.

- **Editing and review first.** Open a file, navigate a project, inspect local Git changes, and compare them side by side without an AI prompt or onboarding flow taking over the workbench.
- **Small default extension set.** The [33 bundled extensions](lean/bundled-extensions.json) provide syntax, themes, and local Git. Only Git and Git Base have executable entry points in the packaged set. Add language servers, formatters, and other tools when you need them.
- **Extensions remain available.** The Extensions view uses [Open VSX](https://open-vsx.org/) for deliberate searches and installs, with verification against its pinned Ed25519 public key. Local VSIX installation is also supported. Extensions may have their own resource use and network behavior.
- **A separate, recognizable app.** The emerald theme and icon make it easy to distinguish from VS Code; independent storage keeps settings and installed extensions separate.
- **Less shipped development baggage.** Release packaging removes generated JavaScript source maps from the app copy. The v0.4.0 release also uses the optimized production bundle. Package size alone does not prove a runtime-memory saving.
- **Git when you ask for it.** The bundled Git extension waits until you open Source Control, a Git resource, or a Git command instead of activating merely because a folder contains `.git`. Repository review remains available on demand. This v0.3.0 change has not shown a meaningful file-ready startup gain in internal trials.
- **Updates with the same controls you already know.** The existing update UI uses Electron's macOS updater, a signed and notarized app ZIP on GitHub Releases, and a static feed containing the ZIP's hash and size. Checks begin after the workbench opens; metered connections defer automatic work.

![Editing the Lean VS Code fork in Lean VS Code](docs/screenshots/editor.png)

![Reviewing a local Git change in the fork](docs/screenshots/git-review.png)

The screenshots show this fork's own source and its local Git change view.

## What to expect

Lean VS Code v0.4.0 is based on Code-OSS **1.139.1** and keeps that extension API version; **0.4.0** is this fork's release number. Core editor features, file search, integrated terminal, local Git review, and extension management remain available. Optional extensions are not installed by default. Telemetry, experiments, extension recommendations, and built-in AI prompts are disabled in the shipped default configuration. The macOS update feed is the one background service enabled by default; user-installed extensions can add their own functionality or traffic.

This is an early release, not a claim of native-editor memory use or universal VS Code extension compatibility. The [implementation plan's](IMPLEMENTATION_PLAN.md) 1-second file-ready and 250 MiB idle targets remain unmet. The next optimization work will test the renderer import path and extension-host bootstrap, with core editing and extension compatibility as release gates.

## Build from source

On an Apple Silicon Mac with Xcode command-line tools and Node.js 24.18.0 or newer within major version 24:

```sh
nvm use
npm ci
npm run gulp vscode-darwin-arm64
```

Open `.build/lean-artifacts/LeanVSCode-darwin-arm64/Lean VS Code.app`. The build downloads Electron and compiles native modules, so allow several gigabytes of free space. See [the build guide](lean/docs/BUILDING.md) for signing and notarization. Source code, build scripts, and the curated extension policy are in this repository.

## Project and license

The product branch is `main`; `upstream` tracks [microsoft/vscode](https://github.com/microsoft/vscode). Upstream updates are incorporated after compatibility and release checks. Issues and focused contributions are welcome.

Lean VS Code is an independent community fork, not Microsoft's Visual Studio Code distribution. Code-OSS and fork changes are available under the [MIT license](LICENSE.txt); Microsoft and third-party notices remain in the source and [third-party notices](ThirdPartyNotices.txt). Microsoft's Visual Studio Marketplace is not the default registry for this fork.
