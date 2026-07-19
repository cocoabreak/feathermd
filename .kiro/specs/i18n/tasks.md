# 実装タスク: 多言語対応 (i18n)

## Phase 1: i18n基盤

- [x] 1.1 `$lib/i18n/`（index.svelte.ts / ja.ts / en.ts）— Locale型・i18nストア・全UI文言の辞書化
- [x] 1.2 `Settings.language` 追加（デフォルト "system"）、settings-store読み書き、settingsStore.setLanguage

## Phase 2: フロントエンドUIの置き換え

- [x] 2.1 コンポーネント: SettingsPanel（言語select追加含む）/ Sidebar / TabBar / TOCView / StatusBar / SearchBar / GlobalSearchPanel / SessionRestoreToast / Lightbox / FileTree / MarkdownViewer（信頼確認・コンテキストメニュー含む）
- [x] 2.2 アクション: dialog-actions / file-actions / explorer-actions / export-actions のダイアログ文言
- [x] 2.3 StatusBar読了時間表示のフォーマット関数化（テストの追従更新含む）

## Phase 3: プラグイン

- [x] 3.1 `plugins/types.ts` — LocalizedText型、displayName/description言語別化、PostRenderContextにlocale追加
- [x] 3.2 mermaid / katex / wiki-links の対応（表示名・説明・実行時文言）
- [x] 3.3 `plugins.test.ts` 契約テストにja/en網羅チェック追加、plugins/README.md更新
- [x] 3.4 MarkdownViewer — レンダリングeffectのi18n.locale依存化（言語切替で再レンダリング）

## Phase 4: ネイティブメニュー（Rust）

- [x] 4.1 `menu.rs` — ja/enラベル辞書、build_menuのlocale対応、起動時のsettings.json読み+sys-locale判定
- [x] 4.2 `set_menu_language` コマンド追加、言語切替時の呼び出し
- [x] 4.3 cargo fmt / clippy

## Phase 5: 検証

- [x] 5.1 ユニットテスト全パス、format / lint / check
- [x] 5.2 実機確認: OSロケール準拠の初期表示、設定パネルでの切替即時反映（UI・メニュー・プラグイン文言）、再起動後の言語保持
