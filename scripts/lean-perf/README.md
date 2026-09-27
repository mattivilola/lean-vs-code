# Lean VS Code performance harness

This harness compares an installed Lean VS Code app bundle with an unmodified Code-OSS app bundle on macOS Apple Silicon. It records startup-to-editable-file samples, file-open samples sent to an already-running window, and idle memory for the whole app process tree. It does not install or change user extensions or settings.

For public release comparisons, run the full paired harness on each new minor version (`x.y.0`) and retain its raw results. Routine patch releases do not need a new full run; use targeted checks if a patch could affect performance or a regression is suspected. Always attribute published figures to the exact measured version. This GUI harness opens editor windows and can take desktop focus, so run it only when the desktop is available for testing.

## Run

Build or install both app bundles from the same Code-OSS base revision, then run from the repository root:

```sh
node scripts/lean-perf/benchmark.mjs \
  --lean-app "/Applications/Lean VS Code.app" \
  --oss-app "/Applications/Code - OSS.app" \
  --base-revision 04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1
```

The default is 30 timed startup and 30 existing-window file-open samples per product, one startup warm-up per product, a 5-second existing-window settle period, 3 memory snapshots after 30 seconds of idle time, and an output directory under `scripts/lean-perf/results/`. Pass `--samples`, `--memory-samples`, `--memory-idle-ms`, or `--output-root` to adjust the run. Every run gets a new report directory and a short, isolated profile directory under `/private/tmp/lean-perf-*`; both are retained for inspection. No existing profile is opened or removed.

For internal regression diagnosis, a candidate may be compared against an earlier Lean VS Code release by passing that app as `--oss-app` and setting `--oss-label 'Lean VS Code v0.2.0'`. Do not use that trial as a public speed claim: published performance comparisons use original same-revision Code-OSS. The raw sample key remains `code-oss` for compatibility with the standard comparison parser; use the manifest's app paths and labels when interpreting such a run.

Pass `--git-workspace` for a separate repository-opening benchmark. It creates a task-owned Git fixture under that run's report directory and opens the fixture file with the folder; the default run is a standalone file. Keep these results separate because bundled Git activation is relevant only to the repository case.

First validate bundle paths and inspect the plan without launching either app:

```sh
node scripts/lean-perf/benchmark.mjs \
  --lean-app "/Applications/Lean VS Code.app" \
  --oss-app "/Applications/Code - OSS.app" \
  --base-revision 04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1 \
  --dry-run
```

Run the built-in fixture smoke check with `node scripts/lean-perf/smoke.mjs`. It uses fake app metadata and never launches an editor.

For a real GUI feature check against a built or installed app, run `node scripts/lean-perf/functional-smoke.mjs "/path/to/Lean VS Code.app"`. This launches an isolated profile and temporary Git workspace, then verifies editing and saving, workspace search, an integrated terminal command, a local Git diff, and extension-host webview creation. It writes a per-check JSON result and app log under `.build/lean-artifacts/functional-smoke/`. It does not use the normal user profile. The window can take focus, so run it when the desktop is free.

For a paired first-use workflow diagnostic, run `node scripts/lean-perf/workflow-benchmark.mjs --lean-app "/Applications/Lean VS Code.app" --oss-app "/path/to/Code - OSS.app" --base-revision 04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1 --scenario gitReview --samples 30 --lean-label "signed Lean v0.4.0, minified" --oss-label "original Code-OSS 1.139.1, minified"`. Supported scenarios also include `integratedTerminal`, `workspaceSearch`, `editableFileAndSave`, and `extensionWebview`. Each trial launches a fresh isolated one-file Git workspace. The report separates **action time inside the temporary extension after `onStartupFinished`** from **process spawn to completed workflow**. The latter includes app startup, but is not a key-to-paint measurement. `gitReview` waits for the requested file to become the active editor, runs the Source Control command, waits for the bundled Git extension to find the repository, and reads its diff; `integratedTerminal` waits for a marker written by an actual shell command. Targeted checks poll at 20 ms, which still limits precision for very short timings. Alternate app order, retain failures, and compare against original same-revision Code-OSS. Do not turn a short exploratory run into a public claim; use at least 30 pairs and disclose build provenance.

For a diagnostic renderer startup trace, run `node scripts/lean-perf/trace-startup.mjs "/path/to/Lean VS Code.app" "/path/to/file.txt" "/path/to/trace.json"`. This launches an isolated profile, records Monaco performance marks through the Chrome DevTools Protocol, and writes the Startup Performance report beside the JSON trace as `trace.json.perf.md`. The trace uses a temporary control extension to request the report, which can change the restored editor; use the paired benchmark above for release timing claims. Trace artifacts may include local file paths, so review them before publishing.

## Method

The harness requires `arm64` macOS. Each startup trial gets unique user-data and shared-data directories and an empty extensions directory, then loads the same small control extension into both apps. It performs one raw-only startup warm-up per product before the measured repetitions. The 100 KiB text fixture is read before timing to warm filesystem contents. Timed startup trials use a fresh profile and alternate product order each repetition. Existing-window trials keep one isolated window per product, settle for five seconds, then alternate which product opens a new fixture file first.

Readiness is recorded after VS Code reports the requested file as the active text editor and accepts a reversible `TextEditor.edit` insertion/removal probe. This checks that the extension API can edit the document and restores the fixture contents. The startup number runs from process spawn until the harness sees that readiness marker. The existing-window number runs from spawning the app executable with `--reuse-window <file>` until the running app reports the matching editor as ready. These are app-level file-ready timings; the editability probe is not a hardware key-to-paint measurement.

Memory samples wait for an editable fixture window, idle for the configured interval, then enumerate descendants of the app's launched PID with `ps`. For every PID, the harness runs macOS `/usr/bin/footprint` and reads `phys_footprint`; it sums those per-process values for the reported app-tree total. RSS, derived from `ps`, is included only as a separate diagnostic. The metric is Apple's process physical-footprint accounting, not resident-set size; see Apple's [`ri_phys_footprint` documentation](https://developer.apple.com/documentation/kernel/rusage_info_v1/1577496-ri_phys_footprint). A complete total is emitted only when every observed process has a readable footprint; permission or process-exit errors remain in the raw sample as unavailable values. Access to other processes can be restricted by macOS privacy settings, so rerun from a terminal with appropriate process-inspection access if the capture is incomplete.

The process tree is sampled over a short interval rather than atomically. `footprint` reports per-process accounting; summing it does not deduplicate shared pages between processes. Treat the total as the sum of macOS billed footprints for the observed tree, and do not compare it with Linux PSS or Windows private bytes. Child processes that detach or are reparented outside the launched process tree may not be included.

The report records both app `product.json` versions/commits and the operator-supplied `--base-revision`. The supplied revision is a comparison label, not a cryptographic proof that both binaries came from that source revision. Verify build provenance independently before drawing causal conclusions. The invoking environment is inherited by the apps for normal launch behavior but is never written to the report.

## Output

Each unique result directory contains:

- `manifest.json`: machine, product metadata, fixture size, flags, settings, and supplied comparison revision.
- `samples.jsonl`: raw timing and memory observations, including startup warm-ups, written as the run proceeds. Warm-ups are excluded from percentile summaries.
- `summary.json`: per-product p50/p95/min/max and sample counts. Percentiles use nearest rank (`sorted[ceil(p*n)-1]`); failed samples stay visible in the raw file and do not enter the percentile calculation.
- `/private/tmp/lean-perf-*`: isolated per-run profiles, kept outside the report directory so Electron's Unix socket paths fit macOS's limit. The relative profile paths in raw samples point to them.
- `trials/`, `fixtures/`, and `harness-extension/`: harness-owned run artifacts for inspection. Each trial's `control/app.log` captures launch errors.

The default sample count follows the repository performance plan. Reduce it for a smoke run, then use at least 30 repetitions for reported warm-cache timing results. This harness does not reset the filesystem cache or claim reboot-cold startup.

For a separate diagnostic of repeated launches with each app's own persistent profile, pass `--reuse-startup-profile`. The warm-up seeds the profile, and later launches reuse it while still starting a stopped app process. This can expose V8 code-cache and persisted-state effects; keep its results separate from the default fresh-profile series and compare Lean only with original Code-OSS run in the same mode.
