# 技術設計: 安全性の向上 (security-hardening)

## ステータス

完了（後続更新はADR-009を参照）

> **設計更新 (2026-07-08 / ADR-009)**
> 本ドキュメントは初期設計（各コマンドが `root` 引数を受け取り、フロント側の
> `getRootForPath` で導出したルートに対して `is_within_root` で検証する方式）を
> 記述している。その後、信頼境界の起点がWebView側にある弱点を解消するため、
> **信頼済みルートをRust側の managed state `AllowedRoots` に一元化する方式**へ
> 更新した（`root` 引数を廃止、`is_within_root`→`is_path_allowed`、明示操作でのみ
> `register_root`）。確定した設計と理由は `docs/decisions/ADR-009-20260708-ファイルアクセスの信頼境界をRust側に置く.md` を参照。
> 本文中の `root` 引数・`is_within_root`・`getRootForPath` の記述は歴史的経緯として残す。
>
> **設計更新 (2026-07-11 / ADR-009改訂)**
> WebViewから任意パスを渡せた`register_root`を廃止した。Rustネイティブダイアログ、Rustが直接受信したDnD/CLI、または`authorize_path`のネイティブ確認だけを信頼登録の起点とする。Markdown読込は10MiB、DnD/CLI入力は32パスを上限とする。確定設計はADR-009を参照。

---

## 1. 概要

ローカルファイルリンク・ローカル画像参照の解決範囲を「開いたルート」配下に限定する。
画像は `convertFileSrc`（asset protocol）経由の読み込みを廃止し、Rust側でルート内チェックを行った上でbase64データURLとして返す専用コマンドに置き換える。これにより `tauri.conf.json` の asset protocol scope `["**"]`（任意パス許可）を撤去できる。

```
現状: <img src="asset://localhost/{任意の絶対パス}">  ← "**" scopeが任意パスを許可
変更後: 画像はRust側で {root配下かチェック} → 読み込み → base64 data: URL に変換してJS側へ返す
        asset protocolのワイルドカードscopeは撤去（もしくは無効化）
```

---

## 2. ルート判定ロジック（未決定事項の確定）

各タブの「ルート」は保存済みフィールドを持たず、都度以下のロジックで導出する（KISS: Tab型への項目追加を避ける）。

```typescript
// app/src/lib/actions/security.ts（新規、詳細は§3.2）
function getRootForPath(path: string): string {
  const explorerRoot = explorerStore.rootPath;
  if (explorerRoot && isTrustedPathWithin(path, explorerRoot)) {
    return explorerRoot;
  }
  return parentDir(path); // フォルダを開いていない/ツリー外のファイルは自身の親ディレクトリがルート
}
```

- 「フォルダを開く」でエクスプローラーのルートが設定されており、対象タブのパスがその配下にあれば、そのルートを使う
- そうでなければ（フォルダ未オープン、またはツリー外のファイルを直接開いた場合）そのファイル自身の親ディレクトリをルートとする
- この判定（`explorerRoot` を使うか `parentDir` を使うか）自体は、すでに検証済み・信頼できるパス（過去に正常に開けたタブのパスとエクスプローラーのルート）同士の比較であり、攻撃者が細工したパス文字列ではないため、軽量なテキスト正規化ベースの比較で十分とする
- 一方、**実際にジャンプ先・読み込み先として解決したパスがルート内か**という本質的なセキュリティ境界チェック（§3・§4）は、リンク・画像のいずれもRust側で `std::fs::canonicalize` を用いて検証する（シンボリックリンクも含めて解決するため、双方とも同じ強度で保護される。未決定事項の解消）

---

## 3. ローカルファイルリンクの範囲制限（US-001）

### 3.1 Rust側: 汎用ルート内チェックコマンド

`app/src-tauri/src/commands/file.rs` に追加。画像（§4）とリンク（本節）の双方から使う。

```rust
/// pathがroot配下（シンボリックリンク解決込み）にあるかを判定する
/// 内部実装は §4.1 の canonicalize_within_root を共用する（DRY）
#[tauri::command]
pub fn is_within_root(path: String, root: String) -> bool {
    canonicalize_within_root(&path, &root).is_ok()
}
```

- `is_within_root` と `read_image_data_url`（§4.1）はいずれも `canonicalize_within_root` ヘルパーを共用する。`file.rs` 内での定義順序は問わないため、`canonicalize_within_root` を先に定義しどちらからも参照できるようにする
- `lib.rs` の `invoke_handler` に `commands::file::is_within_root` を追加

### 3.2 フロントエンド側

`app/src/lib/actions/security.ts`（新規）に、ルート候補の導出ロジックのみを置く（実際の境界チェックはRust側 `is_within_root` を都度呼ぶ）。

```typescript
import { explorerStore } from "$lib/stores/explorer.svelte";

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

function parentDir(path: string): string {
  const normalized = normalize(path);
  return normalized.slice(0, normalized.lastIndexOf("/")) || "/";
}

// タブ自身のパスとエクスプローラーのルートという、双方とも信頼できるパス同士の比較のため
// 軽量なテキスト正規化で判定する（攻撃者制御パスの検証には使わない。§2参照）
function isTrustedPathWithin(path: string, root: string): boolean {
  const p = normalize(path);
  const r = normalize(root).replace(/\/$/, "");
  return p === r || p.startsWith(r + "/");
}

export function getRootForPath(path: string): string {
  const explorerRoot = explorerStore.rootPath;
  if (explorerRoot && isTrustedPathWithin(path, explorerRoot)) {
    return explorerRoot;
  }
  return parentDir(path);
}
```

`MarkdownViewer.svelte` の `handleClick`（ローカルファイルリンク分岐）を変更:

```typescript
const resolved = resolveLocalPath(currentPath, filePart);
const root = getRootForPath(currentPath);

if (!(await invoke<boolean>("is_within_root", { path: resolved, root }))) {
  alert(`ルート外のファイルは開けません:\n${resolved}`);
  return;
}

// 同一ファイルへのリンク・openMarkdownFile呼び出しは既存のまま
```

- 絶対パスリンク（`resolveLocalPath` が `/` または `C:/` から始まる絶対パスをそのまま返すケース）も `is_within_root` で同様に弾かれる
- エラー表示は既存の「ファイルを開けませんでした」alertと同じパターンに揃える（未決定事項の確定: alert方式を採用）
- `handleClick` は既存も非同期処理を含む分岐があるため、関数全体を `async` にする

---

## 4. ローカル画像のbase64化（US-002）

### 4.1 Rust側: 新規コマンド

`app/src-tauri/src/commands/file.rs` に追加。

```rust
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::{Path, PathBuf};

/// path・rootをcanonicalizeし、pathがroot配下にあることを検証する（§3の is_within_root と共通処理）
fn canonicalize_within_root(path: &str, root: &str) -> Result<PathBuf, String> {
    let canonical_root =
        std::fs::canonicalize(root).map_err(|e| format!("ルートの解決に失敗しました: {}", e))?;
    let canonical_path =
        std::fs::canonicalize(path).map_err(|e| format!("パスの解決に失敗しました: {}", e))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err("ルート外のファイルです".to_string());
    }
    Ok(canonical_path)
}

/// root配下にあることを検証した上で画像をbase64データURLとして返す
#[tauri::command]
pub fn read_image_data_url(path: String, root: String) -> Result<String, String> {
    let canonical_path = canonicalize_within_root(&path, &root)?;
    let bytes = std::fs::read(&canonical_path).map_err(|e| format!("画像読み込みエラー: {}", e))?;
    let mime = mime_from_extension(&canonical_path);
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

fn mime_from_extension(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}
```

- `base64` クレートを `Cargo.toml` に追加（`[dependencies] base64 = "0.22"`）
- `std::fs::canonicalize` によりシンボリックリンク・`..` を含むパスも安全に解決してから比較する
- `lib.rs` の `invoke_handler` に `commands::file::read_image_data_url` を追加

### 4.2 フロントエンド側: 画像src書き換えロジックの変更

`MarkdownViewer.svelte` の画像変換部分を変更。

```typescript
if (tab?.path) {
  const root = getRootForPath(tab.path);
  const images = Array.from(contentEl.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (
        !src ||
        src.startsWith("http://") ||
        src.startsWith("https://") ||
        src.startsWith("data:")
      ) {
        return;
      }
      const resolved = resolveLocalPath(tab.path, src);
      try {
        img.src = await invoke<string>("read_image_data_url", { path: resolved, root });
      } catch {
        // ルート外 or 読み込み失敗: alt表示のためsrcを空にする（ブラウザ標準の壊れ画像アイコン）
        img.removeAttribute("src");
      }
    })
  );
}
```

- `convertFileSrc` の import と `asset://` / `tauri://` の判定分岐は不要になるため削除
- 従来 `$effect` 内で同期的にDOM操作していた箇所が非同期になるため、`$effect` 自体は async 関数を直接渡せないので即時実行の async IIFE でラップする（既存の他の非同期処理と同様のパターン）

---

## 5. 設定ファイルの変更（US-002, US-003）

### 5.1 `tauri.conf.json`

```diff
     "security": {
       "csp": null,
-      "assetProtocol": {
-        "enable": true,
-        "scope": ["**"]
-      }
+      "assetProtocol": {
+        "enable": false
+      }
     }
```

画像読み込みをRustコマンド経由のbase64に統一するため、asset protocol自体を無効化する。

### 5.2 `capabilities/default.json`

`tauri-plugin-fs` のJS APIはフロントエンドから一切呼び出されていない（画像・ファイル読み込みはいずれも独自Rustコマンド `read_file` / `read_directory` / `read_image_data_url` 経由）ため、`fs:*` permission と `tauri-plugin-fs` の依存自体を削除する。

```diff
   "permissions": [
     "core:default",
     "opener:default",
-    "fs:default",
-    "fs:allow-read-file",
-    "fs:allow-read-dir",
-    "fs:allow-exists",
-    "fs:allow-watch",
     "dialog:default",
     "dialog:allow-open",
     "store:allow-get",
     "store:allow-set",
     "store:allow-save",
     "store:allow-load"
   ]
```

- `Cargo.toml` から `tauri-plugin-fs = "2"` を削除
- `lib.rs` から `.plugin(tauri_plugin_fs::init())` を削除
- 削除後、`npm run tauri dev` でファイル監視（`notify`crateベース、fsプラグインとは無関係）・ファイル読み込み・画像表示に回帰がないことを実機確認する

---

## 6. データフロー

```
Markdownレンダリング後（$effect）
  → 各<img>のsrcを走査
  → http(s)/data: はスキップ
  → それ以外は resolveLocalPath で絶対パス化
  → invoke("read_image_data_url", { path, root: getRootForPath(tab.path) })
      → Rust: canonicalize(root) / canonicalize(path) を比較
      → root配下ならbase64 data URLを返す、そうでなければError
  → 成功: img.src = data URL / 失敗: src属性を削除（壊れ画像アイコン表示）

ローカルファイルリンククリック（handleClick）
  → resolveLocalPath で絶対パス化
  → invoke("is_within_root", { path: resolved, root: getRootForPath(currentPath) }) をチェック
  → false: alertでエラー表示して終了
  → true: 既存のopenMarkdownFileフローへ
```

---

## 7. 残課題

なし。設計フェーズ完了。
