# Completion gates
Frontend (`app/`):
1. `npm run format`
2. `npm run lint`
3. `npm run check`
4. `npm test`
Backend (`app/src-tauri/`) when Rust is affected:
1. `cargo fmt`
2. `cargo clippy -- -D warnings`
3. `cargo test`
Also:
- Perform relevant real-app verification for UI/Tauri behavior.
- Run design-diff review when its trigger applies.
- Run security review for filesystem/path/rendering/Tauri/external-process/persistence/dependency changes.
- Resolve all P0/P1/P2 findings before commit/merge; report deferred P3 rationale.
- Before merge, reconcile tasks.md, requirements unresolved decisions, design status, and backlog.
- Do not commit or push without explicit confirmation.