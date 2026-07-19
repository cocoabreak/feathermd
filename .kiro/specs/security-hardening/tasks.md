# 実装タスク: 安全性の向上 (security-hardening)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: Rust側コマンド実装

### T-001: canonicalize_within_root / is_within_root の実装 ✅

- **依存**: なし
- **概要**: `app/src-tauri/src/commands/file.rs` に共通ヘルパー `canonicalize_within_root` と `is_within_root` コマンドを実装する
- **完了条件**:
  - [x] `canonicalize_within_root(path, root)` が両者をcanonicalizeし、root配下でなければErrを返す
  - [x] `is_within_root(path, root)` がroot配下なら`true`、それ以外・パス解決失敗時は`false`を返す
  - [x] ルート配下の実在パス・ルート外の実在パス・存在しないパスそれぞれのユニットテストがある
- **対応US**: US-001

### T-002: read_image_data_url の実装 ✅

- **依存**: T-001
- **概要**: `base64` クレートを追加し、画像をbase64データURLとして返すコマンドを実装する
- **完了条件**:
  - [x] `Cargo.toml` に `base64 = "0.22"` を追加
  - [x] `read_image_data_url(path, root)` が `canonicalize_within_root` を使ってroot配下を検証する
  - [x] png/jpg/jpeg/gif/svg/webp/bmp/icoの拡張子からMIMEタイプを判定する（`mime_from_extension`）
  - [x] root配下の画像でdata URLが返る・root外の画像でErrになるユニットテストがある
- **対応US**: US-002

### T-003: lib.rsへのコマンド登録 ✅

- **依存**: T-001, T-002
- **概要**: `is_within_root` / `read_image_data_url` を `invoke_handler` に登録する
- **完了条件**:
  - [x] `tauri::generate_handler!` に両コマンドが追加されている
- **対応US**: US-001, US-002

---

## Phase 2: フロントエンド実装

### T-004: security.ts（ルート導出ロジック）の実装 ✅

- **依存**: なし
- **概要**: `app/src/lib/actions/security.ts` を新規作成する
- **完了条件**:
  - [x] `getRootForPath(path)` が実装されている（`explorerStore.rootPath` 配下なら it、そうでなければ親ディレクトリ）
  - [x] `isTrustedPathWithin` はモジュール内プライベート関数とする
- **対応US**: US-001, US-002

### T-005: handleClickへのルートチェック追加 ✅

- **依存**: T-003, T-004
- **概要**: `MarkdownViewer.svelte` の `handleClick` にローカルファイルリンクのルート内チェックを追加する
- **完了条件**:
  - [x] `handleClick` が `async` になっている
  - [x] ローカルファイルリンク分岐で `invoke("is_within_root", ...)` を呼び、`false` ならalertして処理を中断する
  - [x] ルート配下のリンクは従来どおり開ける（回帰なし）
- **対応US**: US-001

### T-006: 画像src変換ロジックの置き換え ✅

- **依存**: T-003, T-004
- **概要**: `MarkdownViewer.svelte` の画像変換処理を `convertFileSrc` から `read_image_data_url` 呼び出しに置き換える
- **完了条件**:
  - [x] `convertFileSrc` のimportと `asset://` / `tauri://` 判定分岐を削除
  - [x] ルート配下の画像はdata URLとして表示される（回帰なし）
  - [x] ルート外の画像は `src` 属性が削除され、壊れ画像表示になる
  - [x] `http://` / `https://` / `data:` 始まりの画像srcは従来どおりスキップされる
- **対応US**: US-002

---

## Phase 3: 権限・設定の最小化

### T-007: asset protocolの無効化 ✅

- **依存**: T-006
- **概要**: `tauri.conf.json` の `assetProtocol` を無効化する
- **完了条件**:
  - [x] `assetProtocol.scope` のワイルドカード `["**"]` が削除されている
  - [x] `assetProtocol.enable` が `false` になっている
- **対応US**: US-002

### T-008: tauri-plugin-fsと関連権限の削除 ✅

- **依存**: T-007
- **概要**: エクスポート保存をRustネイティブコマンドへ移したうえで、`tauri-plugin-fs` 依存・登録・権限を削除する
- **完了条件**:
  - [x] `app/src-tauri/Cargo.toml` から `tauri-plugin-fs` を削除
  - [x] `lib.rs` から `.plugin(tauri_plugin_fs::init())` を削除
  - [x] `capabilities/default.json` から `fs:*` permissionを削除
- **対応US**: US-003

---

## Phase 4: 品質確認

### T-009: 動作確認 ✅

- **依存**: Phase 3完了
- **概要**: 開発環境・実機での動作確認とコード品質チェック
- **完了条件**:
  - [x] ルート配下の相対パス画像・リンクが従来どおり表示・遷移できる（回帰なし）
  - [x] ルート外を指す画像・リンクが遮断される（`../` トラバーサル、絶対パス双方で確認）
  - [x] ファイル単体を直接開いた場合、親ディレクトリ配下は許可・それ以外は拒否されることを確認（フォルダ未オープン時に確認。フォルダを開いている状態でその配下のファイルを単体で開いた場合はフォルダ全体がルートになる仕様と確認・合意済み）
  - [x] `cargo fmt` / `cargo clippy` / `cargo test` がエラーなく通る
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
  - [x] `npm run tauri dev` の実機でファイル監視・ファイルを開く・フォルダを開く操作に回帰がないことを確認（fsプラグイン削除の影響確認）
- **対応US**: 全US

---

## Phase 5: 信頼登録入口とリソース制限の再強化

### T-010: WebViewからの無確認登録を廃止 ✅

- [x] 公開`register_root`コマンドを削除する
- [x] ファイル・フォルダー・カスタムCSS選択をRustネイティブダイアログへ移す
- [x] DnD・CLI入力をRust側で直接信頼登録する
- [x] 最近使った項目・セッション復元・外部リンク・保存済みCSSは`authorize_path`のネイティブ確認を通す
- [x] 開発用E2E認可はreleaseビルドで常に拒否する

### T-011: リソース制限 ✅

- [x] `read_file`をMarkdown拡張子に限定する
- [x] Markdown読込を10MiB以下に制限し、実読込量にも上限を適用する
- [x] DnD・CLIの1入力を32パスまでに制限する
- [x] サイズ・件数上限のRustユニットテストを追加する

### T-012: 認可DoS・TOCTOU対策 ✅

- [x] Rustネイティブダイアログを同時に1件だけ許可し、並列要求を拒否する
- [x] open済みファイルハンドル自身の最終解決パスを取得し、許可ルート内か検証する
- [x] 安全なハンドル読込をMarkdown・カスタムCSS・画像・全文検索へ適用する
- [x] CLI引数から実行ファイル自身を除外してから32件上限を適用する
- [x] ダイアログ直列化とCLI境界値のユニットテストを追加する
- [x] ディレクトリ・全文検索・Wiki走査をcanonicalize済み起点と候補再検証へ変更し、件数上限を設ける
- [x] Wikiリンク解決の入力を最大1,000件に制限し、境界値テストを追加する
- [x] 外部エディターの任意コマンド引数を廃止し、Rustネイティブ認可済みstateだけから起動する
- [x] 外部エディター設定を空にした場合はRust側認可stateも解除し、登録・置換・解除をテストする
