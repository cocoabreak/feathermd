# Tech stack
- Desktop: Tauri v2; Rust edition 2021; WebView2 primary runtime.
- Frontend: Svelte 5 + SvelteKit static adapter, TypeScript strict, Vite, Tailwind CSS 4.
- Tests: Vitest + Testing Library; Rust built-in tests.
- Rich Markdown: markdown-it, Shiki, Mermaid, KaTeX, DOMPurify.
- Package manager: npm in `app/`.
- Notable Rust pin: `time >=0.3.0,<0.3.52` due to cookie incompatibility.