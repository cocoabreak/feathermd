# FeatherMD project map
- Product: local Markdown viewer; viewer-only, no editing. Windows Must, Linux Nice-to-have, macOS lowest priority.
- Frontend: `app/src` (SvelteKit). Read `mem:frontend/core` for state/actions/rendering structure.
- Backend: `app/src-tauri/src` (Tauri v2/Rust). Read `mem:backend/core` for commands and filesystem trust boundary.
- Specs: `.kiro/specs/<feature>/{requirements,design,tasks}.md`; workflow requirements → design → tasks → implementation.
- ADRs: `docs/decisions`. ADR-009 owns the filesystem trust-boundary decision.
- Project steering: `.kiro/steering/{product,conventions,structure}.md`; these are authoritative.
- Never record real local absolute paths or OS usernames in repository artifacts.