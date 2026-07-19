# Backend structure and security
- `app/src-tauri/src/lib.rs`: Tauri setup and command registration.
- `app/src-tauri/src/commands`: filesystem, watcher, search, launch, menu, wiki commands.
- Filesystem trust boundary is Rust-side `AllowedRoots`; ADR-009 is authoritative.
- `register_root` is the only trust-registration entry and is allowed only for explicit user actions/replayed explicit actions.
- File-reading commands must canonicalize and verify membership in allowed roots; preserve symlink escape protection and dangerous-root rejection.
- Trust roots reset each process and are not persisted.
- `stat_path` returns only existence/type metadata and intentionally does not require trust registration.