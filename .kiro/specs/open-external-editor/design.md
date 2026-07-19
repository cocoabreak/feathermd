# 技術設計: 外部エディタ連携

## ステータス

完了（2026-07-11セキュリティ更新。Rust側コマンド`open_in_editor`は認可済み`ExternalEditorState`だけを使用する。詳細はtasks.mdの注記を参照）

## アーキテクチャ
- **Tauri バックエンド**:
  - Rustの`open`クレートを使用し、検証済みMarkdownファイルをOS既定アプリまたは認可済み外部エディターで開く。
  - 外部エディターはRustネイティブpickerまたはネイティブ確認を通して`ExternalEditorState`へ保持する。
  - WebViewから`open_in_editor`へ任意コマンドを渡すインターフェースは持たない。
