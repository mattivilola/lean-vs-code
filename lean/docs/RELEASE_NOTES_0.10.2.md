# Lean VS Code v0.10.2 release notes

**Open New External Terminal** now opens the workspace in [Lean Term](https://leanterm.com) when it is installed as `/Applications/Lean Term.app`. Otherwise, the default remains Apple Terminal. An explicit `terminal.external.osxExec` setting still takes priority. External debug launches use Apple Terminal when the selected app is Lean Term, since Lean Term does not yet run debuggee commands. The integrated terminal is unchanged.

This patch includes `bb435f3f1c6b0329b618d536f456b72e87b2e235` and the staged bundle timestamp fix from `4bb5407e230e0b14dd17e1d547ff11fb82adbedb`. The latter gives macOS a fresh app-folder timestamp when it extracts the release, so its icon service can detect future artwork changes. The app name, bundle identifier, profile, extension API (Code-OSS 1.139.1), and update feed stay the same. Unreleased v0.11 work is excluded.

## Validation and publication

The Apple Silicon build was compiled from `a3059ad9152daf61a96b25deed201e352abbd3b9` with Node 24.21.0 and Electron 43.6.0. The Code-OSS base is `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`. Typecheck, lint for the three changed TypeScript files, the 87-actor compatibility guard, and all 19 focused external-terminal tests passed. The terminal tests use a mocked launcher to cover application selection and workspace folder arguments. The [compact preflight](../performance/v0.10.2-source-functional-no-timing.json) verified editing and saving a test file.

This patch uses untimed functional checks. Historical performance claims retain their measured release versions.
