# Lean VS Code v0.10.3 release notes

The Apple Silicon app can retry an update through the GitHub API when the regular update feed or ZIP download fails. This covers the HTTP 504 failure seen after v0.10.2. The retry checks that the API describes a stable release and verifies the ZIP size and SHA-256 before the native updater verifies the app’s signature and installs it.

Earlier versions use the original download route. If that route is unavailable during the upgrade to v0.10.3, install the signed DMG by replacing **Lean VS Code.app** in Applications. The app reads your existing settings and extensions on the next launch.

Release verification uses focused functional and updater checks for this patch. Existing performance figures retain the versions measured in their original trials.
