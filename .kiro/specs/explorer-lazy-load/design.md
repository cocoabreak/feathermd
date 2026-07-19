# 技術設計: エクスプローラーの遅延読み込みと.gitignore考慮 (explorer-lazy-load)

## ステータス

完了（実装済み・mainへマージ済み。squashコミット `2f3183e`）

---

## 1. 概要

`read_directory` を「全再帰走査で完全なツリーを返す」方式から「**直下1階層のみ返し、サブフォルダは展開時にフロントエンドが同コマンドを再度呼んで遅延取得する**」方式へ変更する。あわせて走査を `ignore` クレートの `WalkBuilder` に置き換え、.gitignore対象の除外（設定で切り替え可能）と表示対象拡張子（md/markdown）のフィルターをRust側で行う。

```
フォルダを開く → read_directory(root) が直下1階層を返す → ツリー表示
  → サブフォルダを展開 → children未取得なら read_directory(subdir) を呼ぶ
  → 取得した子エントリをツリーの該当ノードへ差し込む
```

---

## 2. 代替案の比較（採否の根拠）

調査時に3案を検討した:

| 案 | 内容 | 採否 |
|---|---|---|
| 案1: 除外リスト | `node_modules` / `target` / `.git` 等をハードコードでスキップ | **不採用**（.gitignore考慮で代替） |
| 案2: 遅延読み込み | 展開時に1階層ずつ読む（VS Code方式） | **採用** |
| 案3: 拡張子フィルター | 表示対象（md/markdown）以外をRust側で落とす | **採用** |

- 案2と案3は補完関係にあり併用する。オープン時間が「配下の総ファイル数」ではなく「直下のエントリ数」だけで決まるため、除外リストなしでも速度問題が根本解決する。
- 案2の遅延読み込みでは「フォルダの中身は展開するまで分からない」ため、案3でファイルを絞っても中身が空のフォルダ（`node_modules` 等）自体はツリーに残る。当初は案1を薄く併用してこれを隠す想定だったが、**「gitで管理しないフォルダはファイルが多数ある」という一般則から.gitignore考慮の方が本質的**という指摘（ユーザーフィードバック）により、ハードコードの除外リストは持たず.gitignore考慮で代替することにした。
  - gitignore解釈は自前実装せず `ignore` クレート（ripgrepと同じ実装。ネストした.gitignore・否定パターン・グローバルgitignoreに対応）を使う。既に全文検索（global-search）の依存に入っていたため追加コストなし。
  - gitリポジトリでないフォルダには.gitignoreがなく全表示になるが、遅延読み込みにより速度問題は起きないため挙動として素直。
- .gitignore考慮は**設定でON/OFF可能**とする（要求）。デフォルトON。

---

## 3. バックエンド (Rust)

### 3.1 `read_directory`（`commands/file.rs`）

- シグネチャ: `read_directory(path: String, respect_gitignore: bool, state: State<AllowedRoots>)`
- `WalkBuilder::new(path)` に以下を設定して1階層のみ走査する:
  - `max_depth(Some(1))` — 直下のみ。depth 0（起点自身）はスキップ
  - `hidden(false)` — 隠しファイルの表示可否はフロントエンドの設定（`showHiddenFiles`）で切り替えるため、Rust側では除外しない
  - `git_ignore` / `git_global` / `git_exclude` / `ignore` / `parents` — すべて `respect_gitignore` に連動
- **`parents(true)` が遅延読み込みとの併用の要**: サブフォルダ展開時は起点がそのサブフォルダになるため、親ディレクトリを遡ってルートの.gitignoreを解決する必要がある
- ファイルは `VIEWABLE_EXTENSIONS`（md / markdown、大小文字無視）のみ返す。ディレクトリは常に返す（中身に表示対象があるかはこの時点で判定できない）
- `children` は常に `None`（未取得）。**serdeで `null` にシリアライズされる**ため、フロントエンドの未取得判定は `undefined` 厳密比較ではなくtruthinessで行うこと
- 読めないエントリは黙ってスキップ（従来の挙動を踏襲）

### 3.2 `search_in_directory`（`commands/search.rs`）

- `respect_gitignore: bool` パラメーターを追加し、同じ設定に連動させる
- 従来は無条件で `git_ignore(true)` だったため、「.gitignoreを考慮しない」設定を新設したことに伴い明示的なパラメーターに変更

---

## 4. フロントエンド

### 4.1 遅延読み込み（`actions/explorer-actions.ts` 新設）

- `loadDirectory(path)`: `read_directory` を設定値（`respectGitignore`）付きで呼ぶ共通ヘルパー。`dialog-actions.ts` の `openFolder` もこれを使う
- `toggleDirectory(entry)`: 開閉を切り替え、展開時に `entry.children` が未取得（`null`）なら遅延読み込みして `explorerStore.setChildren()` で差し込む。読み込み中の二重取得は `loadingDirs` で防ぐ
- `reloadFolderTree()`: 設定トグル変更時にルートから読み直す（展開状態はリセットされる）

### 4.2 ストア（`stores/explorer.svelte.ts`）

- `setChildren(path, children)`: ツリーを深さ優先で探索して該当ノードに子を差し込む（Svelte 5の`$state`は深いプロキシのためネスト代入で反応する）
- `loadingDirs: Set<string>`: 読み込み中表示と二重取得防止に使う

### 4.3 設定（`stores/settings.svelte.ts` / `settings-store.ts` / `SettingsPanel.svelte`）

- `respectGitignore: boolean`（デフォルト `true`）を追加し、既存設定と同様に永続化
- 設定パネル「表示」セクションに「.gitignoreを考慮」トグルを追加。変更時は保存後に `reloadFolderTree()` を呼ぶ

### 4.4 拡張子フィルターの一本化

- `FileTree.svelte` にあったフロント側の拡張子フィルター（`MARKDOWN_EXT`）は削除し、Rust側に一本化（DRY）。フロントに残る絞り込みは隠しファイル（`is_hidden` × `showHiddenFiles`）のみ

---

## 5. 実測結果（検証時）

| 操作 | 変更前 | 変更後 |
|---|---|---|
| markdown-viewerルート（5.2万ファイル）を開く | 数秒 | **14ms** |
| サブフォルダ（`app/`）展開 | —（一括読込済み） | 10ms |
| 全文検索（"Mermaid"、22ファイルヒット） | — | 138ms・エラーなし |

.gitignore考慮ONで `node_modules` / `target` / `.svelte-kit` / `build` がツリーから消え、OFFにすると表示されることを実アプリで確認済み。
