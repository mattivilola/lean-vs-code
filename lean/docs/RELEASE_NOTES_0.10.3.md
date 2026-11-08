# Lean VS Code v0.10.3 release notes

The Apple Silicon app can retry an update through the GitHub API when the regular update feed or ZIP download fails. This covers the HTTP 504 failure seen after v0.10.2. The retry checks that the API describes a stable release and verifies the ZIP size and SHA-256 before the native updater verifies the app’s signature and installs it.

Earlier versions use the original download route. If that route is unavailable during the upgrade to v0.10.3, install the signed DMG by replacing **Lean VS Code.app** in Applications. The app reads your existing settings and extensions on the next launch.

Release verification uses focused functional and updater checks for this patch. Existing performance figures retain the versions measured in their original trials.


The minified Apple Silicon app was built from `0728eb43f4a20e73f3e43c5c09d5a5b1a6258b8a` with Node 24.21.0 and Electron 43.6.0, on Code-OSS base `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`. Electron’s ordinary checksum URL returned HTTP 504 during the build. The official checksum manifest retrieved through the GitHub API matched the published digest, and the packager used it to validate the cached Electron archive.

Typecheck, lint, the nine focused updater tests, and the desktop compatibility guard passed. The tests cover stable release selection, matching feed and ZIP metadata, rejection of incomplete or corrupted archives, cancellation, and private delivery to the native updater.

Both [signed native fallback trials](../performance/v0.10.3-forced-update-fallback.json) passed. A disposable signed app used the exact v0.10.3 updater code with an older version number so it could install the real public v0.10.2 release. One trial returned HTTP 504 for the normal feed. The other served a valid normal feed and returned HTTP 504 for its ZIP. Each retried once through the live GitHub API, reached **Ready**, restarted into the signed destination, and retained the test profile’s settings and extension.
