# FeatherMD

<p align="center">
  <img src="app/src-tauri/icons/icon-source.png" alt="FeatherMD logo" width="180">
</p>

[日本語](README.ja.md)

FeatherMD is a fast, read-only viewer for local Markdown files and Markdown documents stored in ZIP archives. It combines a Tauri v2 and Rust backend with a Svelte 5 interface, providing rich rendering without turning the viewer into an editor.

> FeatherMD currently prioritizes Windows. Linux support is a secondary goal, and macOS support is lower priority.

## Highlights

- **Rich Markdown rendering** — CommonMark-style Markdown, GitHub-style tables and task lists, syntax highlighting with Shiki, KaTeX math, Mermaid diagrams, emoji, and YAML frontmatter.
- **Native files and ZIP archives** — Open `.md` and `.markdown` files directly, or browse and view Markdown entries inside ZIP archives without extracting them first.
- **Explorer and tabs** — Open a folder as the Explorer root, lazily browse Markdown files, open and reorder multiple tabs, pin tabs, reopen a closed tab, and track file changes automatically.
- **Navigation** — Generated outline, Wiki links (`[[Page]]`) with backlinks, local Markdown links, Back/Forward history, heading anchors, and scroll-position preservation per tab.
- **Search and quick access** — Find text in the current document, search the Explorer root, quickly open files by name, or find commands from the command palette.
- **Images and diagrams** — Resolve trusted local images safely and inspect images or Mermaid diagrams in a zoomable, pannable lightbox.
- **Desktop workflows** — Open files or folders from native dialogs, drag and drop, recent history, keyboard shortcuts, the command line, or the optional Windows Explorer context menu.
- **Session continuity** — Restore tabs, pinned state, the active tab, view modes, scroll positions, in-file searches, Explorer state, and the last Explorer root. The last explicitly approved Explorer root is the only root trusted across restarts.
- **Customization** — Light, dark, and system themes; content zoom; resizable Explorer and outline areas; renderer toggles; code themes; optional line numbers; and scoped custom CSS.
- **Utilities** — Rendered/source view switching, code-copy buttons, reading statistics, external-editor integration, printing/PDF, HTML export, and SVG/PNG export for diagrams.
- **Localized UI** — Japanese and English UI, including the native application menu.

## Security model

FeatherMD treats Markdown as potentially untrusted input. The guarantees below describe release builds.

- File access is validated by the Rust backend against canonicalized allowed roots.
- Drive roots, Windows system directories, and the user-profile root cannot be trusted as broad Explorer roots.
- The WebView cannot silently add trusted folders. New folders require an OS-originated action or a native confirmation dialog.
- Only the most recently approved Explorer root is persisted as trusted; other recent folders require confirmation again.
- Rendered HTML is sanitized, Mermaid uses strict security settings, and the app runs with a restrictive Content Security Policy.
- Local Markdown, images, custom CSS, searches, and directory traversal have type, size, or entry-count limits where applicable.
- At startup, FeatherMD checks GitHub Releases for a newer version by default. This can be disabled in Settings. The update request does not include document contents or local file paths.
- External HTTPS images follow the selected privacy policy. Under the default policy, they are not requested until the user approves them for the current document.

This model limits what a malicious document can access, but it does not make an untrusted file inherently safe. Review unexpected confirmation prompts before approving them.

> Development builds expose a debug-only authorization hook for CDP-based UI testing. Do not use `npm run tauri dev` to inspect untrusted documents; use a release build for that purpose.

## Common shortcuts

| Action                    | Shortcut                      |
| ------------------------- | ----------------------------- |
| Open file / folder        | `Ctrl+O` / `Ctrl+Shift+O`     |
| Find in page / directory  | `Ctrl+F` / `Ctrl+Shift+F`     |
| Back / Forward            | `Alt+Left` / `Alt+Right`      |
| Next / previous tab       | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Close active tab          | `Ctrl+W`                      |
| Toggle Explorer / outline | `Ctrl+B` / `Ctrl+J`           |
| Open settings             | `Ctrl+,`                      |
| Content zoom              | `Ctrl++`, `Ctrl+-`, `Ctrl+0`  |

The title-bar menu shows the native application menu and its available commands.

## Installation

Release packages are published on [GitHub Releases](https://github.com/cocoabreak/feathermd/releases).

Release binaries are not code-signed. Windows Defender SmartScreen may therefore show an "unrecognized app" warning, and macOS may block an unnotarized application until the user explicitly approves it. Download FeatherMD only from the official Releases page above and confirm that you trust the source before bypassing an operating-system warning.

| Platform                    | Support level | Distribution notes                                                                                                         |
| --------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Windows x64                 | Primary       | MSI and NSIS (`.exe`) installers plus `FeatherMD_<version>_x64-portable.zip`. Microsoft Edge WebView2 Runtime is required. |
| Linux x64                   | Best effort   | CI-built packages are published with the release; desktop integration may vary by distribution.                            |
| macOS (Apple Silicon/Intel) | Experimental  | A universal CI build is published, but macOS has the lowest support priority and the application is not notarized.         |

### Build prerequisites

These are required only when building FeatherMD from source:

- Node.js 24 LTS
- Rust and Cargo
- Platform prerequisites required by Tauri v2
- Windows: Microsoft Edge WebView2 Runtime (included with current Windows 11 installations)

### Build and run from source

```bash
git clone https://github.com/cocoabreak/feathermd.git
cd feathermd/app
npm ci
npm run tauri dev
```

Create a release build with:

```bash
npm run tauri build
```

### Quality checks

Run frontend checks from `app/`:

```bash
npm run format
npm run lint
npm run check
npm test
```

Run Rust checks from `app/src-tauri/`:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines. The feature specifications and architectural decisions are maintained under [`.kiro/specs`](.kiro/specs) and [`docs/decisions`](docs/decisions).

Release history is available in the [changelog](CHANGELOG.md).

## Disclaimer

FeatherMD is an independent open-source project. It is not affiliated with, sponsored by, or endorsed by any other product or project named "Feather".

## License

FeatherMD is licensed under the [MIT License](LICENSE).
