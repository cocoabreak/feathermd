# Frontend structure
- `app/src/routes/+page.svelte`: app lifecycle and top-level event wiring.
- `app/src/lib/actions`: reusable user-operation flows (file, dialog, explorer, history, security).
- `app/src/lib/stores`: Svelte reactive state.
- `app/src/lib/components`: UI components.
- `app/src/lib/markdown`: parsing, rendering, sanitization, search, reading stats.
- `app/src/lib/plugins`: renderer/Markdown extensions.
- `app/src/lib/commands`: command registry, built-ins, keyboard mapping.
- Prefer shared actions over duplicating operation flows in components.
- `openMarkdownFile` intentionally does not register trust; explicit user-action callers must use `registerRoot` first where appropriate.