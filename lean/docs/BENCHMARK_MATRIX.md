# Developer workflow benchmark matrix

Every public speed comparison uses **original Code-OSS built from the fork's upstream base revision**, on the same Apple Silicon Mac and in the same build mode as the Lean VS Code release. The current upstream revision is `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`. The comparator is a locally repaired source build, not Microsoft's distributed VS Code app. See [performance history](PERFORMANCE.md) for the exact build provenance and published results.

The primary goal remains stopped-process launch to an **editable requested file**. Additional workloads should show whether that gain carries through to work a developer actually finishes. A fast window with a slow or broken action is not a successful result. Keep action-only time beside full launch-to-task time, and disclose regressions.

| Workload | Completion event | Why it matters | Current evidence |
| --- | --- | --- | --- |
| Open a 100 KiB file | Requested editor is active and accepts a reversible edit | Direct measure of the sub-1-second startup goal | [30 paired launches, v0.4.0](../performance/v0.4.0-vs-code-oss-1.139.1-minified.json) |
| Open a 10,000-file Git workspace | Requested tracked file is editable | Exercises repository startup without conflating it with standalone-file launch | [30 paired launches, v0.4.0](../performance/v0.4.0-git-workspace-vs-code-oss-1.139.1-minified.json) |
| Review a local Git change | Bundled Git API discovers the repository and returns the changed file's diff | Measures first-use code review, including Git activation | [30 paired launches, v0.4.0](../performance/v0.4.0-git-review-vs-code-oss-1.139.1-minified.json) |
| Edit and save the requested file | Insert succeeds, document saves, and changed bytes are verified on disk | Tests the path from app launch to a completed editing task | [30 paired launches, v0.4.0](../performance/v0.4.0-edit-save-vs-code-oss-1.139.1-minified.json) |
| Search a populated workspace | Text search returns the expected matches and count | More useful than timing only the Search panel opening | Fixture and completion probe needed |
| Run a terminal command | Integrated shell writes a verified result | Includes terminal creation and shell readiness | Functional check passes; short exploratory timing showed no established gain |
| Open an extension webview | Webview content signals that it has loaded and can message its extension | Checks extension UI startup, not just API object creation | Functional check passes; painted/content-ready probe needed |
| Switch files in an open window | Second requested file is editable | Detects a first-file optimization that hurts everyday navigation | Existing-window data is recorded; no v0.4.0 speed claim |
| Reopen a real multi-root project | Target file editable, Git ready, and configured extensions activated | Tests a representative expert workflow | Fixture and compatibility set needed |

For each new **minor** release, measure the primary file-ready result and selected completed workflows against the same-revision Code-OSS comparator. Alternate launch order, use at least 30 pairs for a public claim, keep failures in the raw report, and publish median and p95 with absolute milliseconds. Recheck a result in a separate run if it is near measurement noise. Attribute each claim to the exact signed release that was tested; development-candidate or direct Lean-version results remain internal diagnostics.

Memory needs a separate protocol: several **independent launches per app**, not multiple snapshots of one launch, with idle and peak app-tree footprint and an optional long-session extension workload. Report absolute MiB, process count, and the method before a memory-saving percentage. Cold-cache claims need a controlled reboot or equivalent documented procedure; warm-cache launch results must retain their label. CPU, energy, and package size can be tracked as additional diagnostics but should not be presented as startup or memory gains.

Promote a workload to a website/README speed claim only if it passes its functional endpoint on both products, has comparable fixtures and build settings, and shows a repeatable gain. Keep the website's comparison **against Code-OSS** even while internal reports track Lean's history between versions. Include slower substeps and any p95 regression near the associated claim.
