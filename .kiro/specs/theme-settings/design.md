# 技術設計: テーマ・スタイル設定

## アーキテクチャ
- **状態管理 (`settings-store.svelte.ts`)**:
  - `theme`: `'light' | 'dark' | 'system'` (default: 'system')
  - `codeTheme`: string (default: 任意のモダンなテーマ)
  - `showLineNumbers`: boolean (default: false)
- **テーマ反映メカニズム**:
  - `+layout.svelte` 等のトップレベルで、`theme`の設定を監視し、`<html>` タグの `class="dark"` などをトグルする。
  - OSテーマの監視は `window.matchMedia('(prefers-color-scheme: dark)')` を使用。
  - 同じ監視処理からTauriコマンドを呼び出し、`AppHandle::set_theme`でネイティブメニューにも`light` / `dark` / `system`を反映する。
- **コードブロック**:
  - Shiki (または highlight.js/Prism.js) などのハイライターに対し、設定された `codeTheme` を適用して再レンダリングをトリガーする。
  - 行番号はCSSカウンター、またはレンダラーの設定で出力する。
