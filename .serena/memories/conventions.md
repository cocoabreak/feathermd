# Project conventions
- Communication and documentation: Japanese; code identifiers: English.
- Line endings: LF.
- GitHub Flow; never commit directly to main. Branches: feat/, fix/, docs/, refactor/, chore/. Conventional Commits, Japanese body.
- Do not create/change README or documentation without user confirmation. Do not delete/disable tests without confirmation.
- DRY, KISS, SRP; constants instead of magic numbers.
- Svelte state is generally centralized under `src/lib/stores`; reusable user operations under `src/lib/actions`; commands use registry/keymap separation.
- New functionality follows the spec workflow and completed tasks must be marked [x]; out-of-v1 tasks [-].
- Filesystem/path/rendering/Tauri changes require security review; feature/refactor/cross-layer changes require design-diff review.
- Use Serena semantic tools for symbol relationships and impact analysis; use text search for strings/config/docs and broad unknown-name discovery.