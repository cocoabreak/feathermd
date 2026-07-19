# Contributing to FeatherMD

Thank you for your interest in contributing to FeatherMD.

FeatherMD is primarily maintained as an independent project with limited
maintenance capacity. Contributions are appreciated, but review and
implementation are handled on a best-effort basis.

## Issues

We welcome:

- Reproducible bug reports
- Documentation problems
- Focused feature requests

When reporting a bug, please include:

- The FeatherMD version or commit being used
- Operating system and relevant environment details
- Steps to reproduce
- Expected behavior
- Actual behavior
- A minimal reproduction, when possible

Usage questions and general discussions should be posted in
[GitHub Discussions](https://github.com/cocoabreak/feathermd/discussions).

Please do not report security vulnerabilities in public issues. See
[SECURITY.md](SECURITY.md) for reporting instructions.

Issues are reviewed on a best-effort basis. Opening an issue does not guarantee
implementation or a response within a particular timeframe.

We may close issues that are:

- Duplicates
- Outside the scope of this project
- Related only to unsupported versions or environments
- Missing information required to reproduce the problem
- Inactive after additional information has been requested

## Pull requests

Small and focused pull requests are welcome, including:

- Bug fixes
- Documentation improvements
- Test additions
- Small maintainability improvements

Before starting work on any of the following, please open an issue or discussion
and wait for maintainer agreement:

- New features
- Breaking changes
- Public API changes
- New dependencies
- Large refactorings
- Major architectural changes

Pull requests should:

- Explain the motivation for the change
- Link to a related issue or discussion when applicable
- Keep unrelated changes separate
- Add or update tests when behavior changes
- Pass formatting, linting, tests, and CI checks

A pull request may be declined even if it is technically correct when it does
not align with the project's scope, direction, compatibility goals, or
maintenance capacity.

## Development setup

### Prerequisites

- [Node.js](https://nodejs.org/) 24 LTS
- [Rust](https://rustup.rs/) on the stable channel
- The platform-specific [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Build and run

```bash
git clone https://github.com/cocoabreak/feathermd.git
cd feathermd/app
npm ci
npm run tauri dev
```

Create a production build with:

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

## Project guidelines

- Keep unrelated changes in separate pull requests.
- Follow the existing Svelte 5 and Rust/Tauri patterns in the codebase.
- File operations must remain behind Rust-side allowed-root validation.
- Discuss substantial changes before creating specifications or starting an
  implementation.
- Feature specifications and architectural decisions are maintained under
  [`.kiro/specs`](.kiro/specs) and [`docs/decisions`](docs/decisions).
