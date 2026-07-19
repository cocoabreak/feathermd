# 実装タスク: 外部エディタ連携

> **注**: 2026-07-11のセキュリティ更新で、WebViewから任意コマンドを渡す方式を廃止した。設定`externalEditorCommand`がある場合はRustネイティブ確認後に`ExternalEditorState`へ保持し、空欄の場合はOSの関連付けデフォルトアプリで開く。

- [-] `@tauri-apps/plugin-shell` の導入（未導入の場合）と `tauri.conf.json` のパーミッション設定 → 不採用。Rust側 `open_in_editor` コマンドで実現（AllowedRootsの検証を通せるため）
- [x] ヘッダー部またはコンテキストメニューに「エディタで開く」アクションの追加 → コンテンツ領域のコンテキストメニュー「外部エディターで開く」（`MarkdownViewer.svelte`）
- [x] ボタン押下時にファイルを外部エディターで開く処理の実装 → `openExternalEditor()`（`file-actions.ts`）が `open_in_editor` を呼び出す。失敗時はエラーダイアログで設定確認を促す
- [x] 外部エディター選択・保存値の再認可をRustネイティブUIで行い、`open_in_editor`はRust stateの認可済み実行ファイルだけを使用する
