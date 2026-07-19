# 技術設計: グローバル検索

## ステータス

完了（2026-07-10整理。コマンド名は `search_in_directory`。正規表現・大文字小文字トグルと.gitignore考慮を追加実装）

## アーキテクチャ
- **バックエンド (Rust)**:
  - 検索処理はRust側で行う（パフォーマンスとファイルアクセスのため）。
  - `search_in_directory(dir_path: String, query: String)` のようなTauriコマンドを実装。
  - 内部で `ignore` クレートや `grep` 的なアプローチを用いて非同期でファイルを走査。
- **フロントエンド**:
  - 検索入力UI、結果リスト表示UI。
  - 検索結果クリック時に、`file-actions.ts` 等を用いてファイルを開き、既存の `search-highlight` 機能にキーワードを渡してハイライトする。\n