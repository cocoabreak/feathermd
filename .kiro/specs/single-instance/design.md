# 技術設計: 複数インスタンス起動の抑止 (single-instance)

## ステータス

完了

---

## 1. 概要

公式`tauri-plugin-single-instance`（Linux/Windows/macOS対応、Android/iOS非対応）を導入する。2回目以降の起動を検知するコールバック内で、既存ウィンドウの最小化解除・フォーカスのみを行う。

```
2回目のプロセス起動
  → OSが単一インスタンスロックを検知 → 1回目のプロセスにコールバック発火
  → app.get_webview_window("main") を取得
  → unminimize() → set_focus()
  → 2回目のプロセスは即終了（ウィンドウを作らない）
```

---

## 2. 未決定事項の確定

- **対象OS範囲**: プラグインの公式サポート対象通りLinux/Windows/macOSに適用する。Android/iOSは非対応なため、Cargo依存を`cfg(any(target_os = "macos", windows, target_os = "linux"))`で条件付けし、Rust側の登録コードは既存の`#[cfg_attr(mobile, tauri::mobile_entry_point)]`と同じ考え方で`#[cfg(desktop)]`により条件分岐する（現状モバイルビルドはスコープ外だが、将来の対応を見据えた既存パターンに揃える）
- **フォーカス対象ウィンドウの特定方法**: `tauri.conf.json`の`app.windows`はlabelを省略しており、Tauriのデフォルトlabel `"main"` が使われる。`app.get_webview_window("main")`で取得する
- **最小化されている場合の復元方法**: `window.unminimize()`を呼んでから`window.set_focus()`する

---

## 3. `src-tauri/Cargo.toml` の変更

```diff
 [dependencies]
 ...
+
+[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
+tauri-plugin-single-instance = "2"
```

---

## 4. `src-tauri/src/lib.rs` の変更

公式ドキュメント通り、single-instanceプラグインは**他のプラグインより先に登録する**必要がある（登録順に処理されるため）。

```diff
 mod commands;

 use commands::watcher::WatcherState;
+use tauri::Manager;

 #[cfg_attr(mobile, tauri::mobile_entry_point)]
 pub fn run() {
-    tauri::Builder::default()
-        .plugin(tauri_plugin_opener::init())
+    let builder = tauri::Builder::default();
+
+    #[cfg(desktop)]
+    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
+        if let Some(window) = app.get_webview_window("main") {
+            let _ = window.unminimize();
+            let _ = window.set_focus();
+        }
+    }));
+
+    builder
+        .plugin(tauri_plugin_opener::init())
         .plugin(tauri_plugin_store::Builder::default().build())
         .plugin(tauri_plugin_dialog::init())
         .manage(WatcherState::new())
         .invoke_handler(tauri::generate_handler![
             commands::file::read_file,
             commands::file::read_directory,
             commands::file::is_within_root,
             commands::file::read_image_data_url,
             commands::watcher::watch_path,
             commands::watcher::unwatch_path,
         ])
         .run(tauri::generate_context!())
         .expect("error while running tauri application");
 }
```

- `_args`・`_cwd`は本specのスコープ外（ファイルパス連携）のため未使用（`_`プレフィックスで警告抑止）
- `unminimize()`・`set_focus()`はいずれも失敗しても致命的ではないため`let _ =`で無視する（ウィンドウが既に表示されている場合`unminimize()`は無害）

---

## 5. データフロー

```
1回目の起動 → 通常通りウィンドウ生成・表示

2回目の起動（OSの単一インスタンス機構が検知）
  → 1回目のプロセス内でtauri_plugin_single_instance::init()のコールバックが発火
  → get_webview_window("main") → unminimize() → set_focus()
  → 2回目のプロセスはウィンドウを作らずに終了
```

---

## 6. 残課題

初期設計時に対象外とした2回目起動時のファイルパス連携は、後続の`.kiro/specs/windows-shell-integration/`で`args`と`cwd`を利用して実装する。
