# Commands (PowerShell, Windows)
Run frontend commands from `app/`:
- Dev: `npm run tauri dev`
- Format: `npm run format`
- Lint: `npm run lint`
- Type/Svelte check: `npm run check`
- Tests: `npm test`
- Build: `npm run build`
Run Rust commands from `app/src-tauri/`:
- Format: `cargo fmt`
- Format check: `cargo fmt --check`
- Lint: `cargo clippy -- -D warnings`
- Tests: `cargo test`
Repository inspection:
- Files: `rg --files`
- Text: `rg -n "pattern" path`
- Status: `git status --short --branch`
- Diff validation: `git diff --check`