# 技術設計: ネイティブUI化

## アーキテクチャ
- **Tauri Config (`tauri.conf.json`)**:
  - `"decorations": false`を設定し、OS標準の枠を消す。透明ウィンドウは使用しない。
- **フロントエンド**:
  - タイトルバーコンポーネント（`Titlebar.svelte`など）を作成。
  - `data-tauri-drag-region` 属性を付与してドラッグ移動を可能にする。
  - Tauri v2の`@tauri-apps/api/window`を使用して、最小化 (`minimize`)、最大化 (`toggleMaximize`)、閉じる (`close`) アクションを実装する。
  - 左端のメニューボタンはRustコマンド`show_app_menu`を呼び、`build_menu`で構築済みのアプリメニューを`popup_menu_at`で表示する。メニュー項目やイベント経路は複製しない。

## データモデル・状態
- 最大化状態を検知し、最大化/元に戻すアイコンを切り替える必要がある。

## 依存関係
- `@tauri-apps/api/window`（既存依存。追加プラグイン不要）
