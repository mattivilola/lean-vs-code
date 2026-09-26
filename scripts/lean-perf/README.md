# Lean VS Code performance harness

This harness compares an installed Lean VS Code app bundle with an unmodified Code-OSS app bundle on macOS Apple Silicon. It records startup-to-editable-file samples, file-open samples sent to an already-running window, and idle memory for the whole app process tree. It does not install or change user extensions or settings.

## Run

Build or install both app bundles from the same Code-OSS base revision, then run from the repository root:

```sh
node scripts/lean-perf/benchmark.mjs \
  --lean-app "/Applications/Lean VS Code.app" \
  --oss-app "/Applications/Code - OSS.app" \
  --base-revision 04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1
```

The default is 30 timed startup and 30 existing-window file-open samples per product, one startup warm-up per product, a 5-second existing-window settle period, 3 memory snapshots after 30 seconds of idle time, and an output directory under `scripts/lean-perf/results/`. Pass `--samples`, `--memory-samples`, `--memory-idle-ms`, or `--output-root` to adjust the run. Every run gets a new report directory and a short, isolated profile directory under `/private/tmp/lean-perf-*`; both are retained for inspection. No existing profile is opened or removed.

To compare a candidate against an earlier Lean VS Code release, pass that app as `--oss-app` and set `--oss-label 'Lean VS Code v0.2.0'` so the report identifies it correctly. The raw sample key remains `code-oss` for compatibility with the standard comparison parser; use the manifest's app paths and labels when interpreting such a run.

First validate bundle paths and inspect the plan without launching either app:

```sh
node scripts/lean-perf/benchmark.mjs \
  --lean-app "/Applications/Lean VS Code.app" \
  --oss-app "/Applications/Code - OSS.app" \
  --base-revision 04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1 \
  --dry-run
```

Run the built-in fixture smoke check with `node scripts/lean-perf/smoke.mjs`. It uses fake app metadata and never launches an editor.

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
