# Changelog

All notable changes to FeatherMD are documented in this file.

## [0.1.0] - 2026-07-19

The first public release of FeatherMD.

### Added

- Read-only viewing for native `.md` and `.markdown` files and for Markdown entries inside ZIP archives.
- Rich Markdown rendering with tables, task lists, footnotes, alerts, emoji, syntax highlighting, KaTeX math, Mermaid diagrams, YAML frontmatter, and trusted local images.
- A folder Explorer, multiple tabs, tab pinning and reordering, closed-tab restoration, file watching, and recent file/folder history.
- Generated outlines, local Markdown links, Wiki links with backlinks, heading anchors, and Back/Forward navigation.
- Rendered/source view switching with independent per-tab scroll positions.
- In-file and directory search, a bounded search-results list, Quick Open, and a searchable command palette.
- Session restoration for tabs, view modes, scroll positions, in-file searches, Explorer expansion, and the last approved Explorer root.
- Large-document safe mode for Markdown files from 5 MiB through 10 MiB, with plain-text viewing and a bounded Rust-generated outline.
- Privacy controls for external HTTPS images: always allow, ask for each document, or block.
- HTML document export, SVG/PNG diagram export, printing/PDF, code copying, reading statistics, and external-editor integration.
- Windows command-line input, single-instance handoff, and optional Explorer context-menu registration for `.md` and `.markdown` files.
- Startup update checks through GitHub Releases, with an option to disable automatic checks in Settings.
- A responsive, accessible interface with English and Japanese localization, native menus, resizable panes, themes, content zoom, and categorized settings.

### Changed

- Improved keyboard and screen-reader support for dialogs, resize handles, search status, drawers, and focus restoration.
- Updated the application identity, metadata, documentation, and icons to the FeatherMD brand and `com.cocoabreak.feathermd` application identifier.
- Hardened trusted-root, path, archive, watcher, export, and session boundaries while keeping filesystem authority in the Rust backend.
- Moved document and diagram exports behind native save dialogs and removed general WebView file-write permission.
- Added watcher and export resource limits and made directory-watch reconciliation atomic.
- Improved reload-time session flushing and restored Explorer and document UI state after an actual WebView reload.
- Removed unused frontend dependencies, corrected runtime/development dependency classification, and updated compatible npm and Cargo dependencies.
- Added Windows WebView2 smoke coverage for core rendering, ZIP, size boundaries, update notification, and session restoration.

### Fixed

- Prevented malformed Mermaid diagrams from leaving temporary error elements outside the document content and disrupting the application layout.
- Preserved successfully rendered Mermaid SVGs while cleaning up Mermaid's temporary rendering elements.
- Preserved stable watcher identities across canonical Windows paths, symlinks, and junctions.
- Prevented export format/extension mismatches and rejected oversized PNG canvas requests before allocation.

### Distribution and security

- Release builds target Windows, Linux, and macOS. Windows releases include MSI and NSIS installers plus a portable ZIP archive and remain the primary supported distribution.
- Release binaries are not code-signed. Windows Defender SmartScreen or macOS Gatekeeper may require explicit user approval; download FeatherMD only from the official GitHub Releases page.
- External images are not loaded silently under the default ask policy, and large documents do not execute rich Markdown rendering in safe mode.
- Startup update checks contact GitHub Releases by default but do not send document contents or local file paths and can be disabled in Settings.

[0.1.0]: https://github.com/cocoabreak/feathermd/releases/tag/v0.1.0
