# Lean VS Code v0.10.2 release notes

**Open New External Terminal** now opens the workspace in [Lean Term](https://leanterm.com) when it is installed as `/Applications/Lean Term.app`. Otherwise, the default remains Apple Terminal. An explicit `terminal.external.osxExec` setting still takes priority. External debug launches use Apple Terminal when the selected app is Lean Term, since Lean Term does not yet run debuggee commands.

This patch includes `bb435f3f1c6b0329b618d536f456b72e87b2e235` and the staged bundle timestamp fix from `4bb5407e230e0b14dd17e1d547ff11fb82adbedb`. The latter gives macOS a fresh app-folder timestamp when it extracts the release, so its icon service can detect future artwork changes. The build uses the stable release branch and the Code-OSS 1.139.1 extension API.

## Validation and publication

The Apple Silicon build was compiled from `a3059ad9152daf61a96b25deed201e352abbd3b9` with Node 24.21.0 and Electron 43.6.0. The Code-OSS base is `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`. Typecheck, lint for the three changed TypeScript files, the 87-actor compatibility guard, and all 19 focused external-terminal tests passed. The terminal tests use a mocked launcher to cover application selection and workspace folder arguments. The [compact preflight](../performance/v0.10.2-source-functional-no-timing.json) verified editing and saving a test file.

The [signed DMG app smoke](../performance/v0.10.2-release-functional-no-timing.json) passed seven checks in a compact window with a disposable profile. It verified editing and saving, file search, workspace text search, the integrated terminal, local Git review, extension webviews, and installing and activating EditorConfig 0.18.2 through Open VSX. The release inventory contains 33 bundled extensions. Git and Git Base are the only bundled extensions that execute code.

This patch uses untimed functional checks. Historical performance claims retain their measured release versions.

## Signed downloads

The [artifact report](../performance/v0.10.2-release-artifacts.json) verifies 2,218 matching entries in the DMG and ZIP app bundles, including the approved teal icon. The smoke-tested copy matched the final DMG. Both extracted apps had current folder timestamps, valid strict signatures, and stapled notarization tickets. Gatekeeper accepted both apps and the DMG.

- Apple Silicon DMG (204,646,398 bytes), SHA-256 `e8ebdcb9ad3bdf3fb9ed19b23b00af154adc81a3f55dc6f0577ae0032039ce9d`
- Auto-update ZIP (192,181,320 bytes), SHA-256 `9d1bc2add0329a941f56a365b06d7d8462affd7c0194eb7e178c8229bd305293`

Apple accepted app submission `8bff31fa-3dbe-48e1-a7f9-402a606daa36` and DMG submission `b5b80db1-e172-4c7b-a00a-e52f45aeab90`.
