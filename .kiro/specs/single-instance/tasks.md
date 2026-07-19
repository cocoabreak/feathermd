# 実装タスク: 複数インスタンス起動の抑止 (single-instance)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: 実装

### T-001: tauri-plugin-single-instanceの導入

- **概要**: Cargo依存追加・プラグイン登録
- **チェックリスト**:
  - [x] `Cargo.toml`に`[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]`で`tauri-plugin-single-instance`を追加
  - [x] `lib.rs`で他プラグインより先に`tauri_plugin_single_instance::init()`を登録
  - [x] コールバック内で`get_webview_window("main")` → `unminimize()` → `set_focus()`
- **対応US**: US-001

### T-002: 動作確認

- **依存**: T-001
- **概要**: ビルド・実機での二重起動確認
- **チェックリスト**:
  - [x] `cargo build`が通る
  - [x] `cargo clippy` / `cargo fmt --check`が通る
  - [x] 実機（Windows）でアプリを起動→もう一度起動し、新規ウィンドウが作られず既存ウィンドウがフォーカスされることを確認（2回目起動プロセスは即終了、実行中プロセスは1つのまま）
  - [x] ウィンドウを最小化した状態で2回目起動し、復元されることを確認（IsIconic: True→False、フォアグラウンドウィンドウも一致）
  - [x] 通常の単一起動（起動・ファイルを開く・終了）に回帰がないことを確認（`cargo test --lib`の既存15件全てpass）
- **対応US**: US-001
