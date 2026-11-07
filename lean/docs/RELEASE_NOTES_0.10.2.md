# Lean VS Code v0.10.2 release notes

**Open New External Terminal** now opens the workspace in [Lean Term](https://leanterm.com) when it is installed as `/Applications/Lean Term.app`. Otherwise, the default remains Apple Terminal. An explicit `terminal.external.osxExec` setting still takes priority. External debug launches use Apple Terminal when the selected app is Lean Term, since Lean Term does not yet run debuggee commands. The integrated terminal is unchanged.

This patch includes `bb435f3f1c6b0329b618d536f456b72e87b2e235` and the staged bundle timestamp fix from `4bb5407e230e0b14dd17e1d547ff11fb82adbedb`. The latter gives macOS a fresh app-folder timestamp when it extracts the release, addressing the stale icon-service cache observed on v0.10.1. The app name, bundle identifier, profile, extension API (Code-OSS 1.139.1), and update feed stay the same. Unreleased v0.11 work is excluded.

## Validation and publication

Pending release validation: focused external terminal tests, production build, signed-app smoke, artifact comparison, notarization and stable update feed. No full GUI performance benchmarks or new speed/memory claims for this patch.
