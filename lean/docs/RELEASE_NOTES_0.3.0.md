# Lean VS Code v0.3.0

Lean VS Code is a focused Code-OSS editor for writing code and reviewing local Git changes. This release measures its performance against a build of the original Code-OSS **at the same upstream revision** and keeps the results available for future version comparisons.

- **18% less time to an editable file:** 1.64 s median versus 2.00 s for same-revision Code-OSS on an Apple M3 Max (30 alternating, warm-cache runs per app).
- **13% lower idle app-tree memory footprint:** 746 MiB median versus 854 MiB for Code-OSS (three macOS physical-footprint snapshots per app after 30 seconds idle).
- The bundled Git extension now activates when Source Control, a Git resource, or a Git command needs it, rather than merely when a folder contains `.git`. Git review and side-by-side diffs remain available.
- The signed Apple Silicon app keeps core editing, search, terminal, and Open VSX extension support, while shipping 33 curated built-in extensions. Optional extensions remain off until installed.

The public [method, signed-release results, and v0.2.0 history](https://github.com/mattivilola/lean-vs-code/blob/main/lean/docs/PERFORMANCE.md) explain the setup and limits. The v0.3.0 Git change did not produce a meaningful direct file-ready speedup over v0.2.0 in development trials; the headline comparison is **each Lean release versus the original Code-OSS baseline**, not a v0.2.0-to-v0.3.0 gain. These numbers are reference-machine measurements, not guarantees for every project or Mac. The 1-second startup and 250 MiB idle targets remain unmet.

The release was built from commit `13fbbf8e65a1733a0b03ce47111d2f1a00c31b02` on Code-OSS 1.139.1, signed with Developer ID Application: Matti Vilola (MM233FKU38), notarized by Apple, and stapled. DMG SHA-256: `e6d0b0a0b4d5c23b639ab62a72a65f85333dee8cd4870eccb64392f082ecc0e0`.

The extracted release app passed signature and Gatekeeper checks, 58 Git integration tests, and 182 focused editor/extension-API tests (with 2 and 5 pending, respectively). An isolated CLI profile installed EditorConfig 0.18.2 from Open VSX and listed it afterward. The full upstream API folder also contains cases that assume browser chat tools, bundled notebook/JSON extensions, or test-only settings unavailable in this lean configuration; 13 of its 347 cases failed under that broad run. These checks do not establish universal extension compatibility.

Open the DMG and drag Lean VS Code into Applications. It can coexist with Microsoft VS Code and keeps separate settings and extensions. There is no automatic updater yet.
