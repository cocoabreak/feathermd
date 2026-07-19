# 実装タスク: エクスプローラーの遅延読み込みと.gitignore考慮 (explorer-lazy-load)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

> 実装済み（squashコミット `2f3183e`、ブランチ `feat/explorer-lazy-load`）。本specは事後記録のため全タスク完了状態で起票している。

---

## Phase 1: バックエンド (Rust)

### T-001: read_directoryの1階層読み＋フィルター化 ✅

- **依存**: なし
- **概要**: `commands/file.rs` の全再帰走査（`read_dir_recursive`）を `WalkBuilder` による1階層走査（`read_dir_single_level`）に置き換える
- **完了条件**:
  - [x] `max_depth(1)` で直下のみ返し、`children` は常に `None`
  - [x] `respect_gitignore` パラメーターで.gitignore考慮を切り替えられる（`parents` 連動含む）
  - [x] ファイルは md / markdown のみ返し、ディレクトリは常に返す
  - [x] ソート順（ディレクトリ優先・大小文字無視のアルファベット順）と `is_hidden` 判定は従来を踏襲
- **対応US**: US-001, US-002

### T-002: search_in_directoryのgitignore設定連動 ✅

- **依存**: なし
- **概要**: `commands/search.rs` に `respect_gitignore` パラメーターを追加し、無条件だったgitignore適用を設定連動にする
- **完了条件**:
  - [x] `respect_gitignore` が `WalkBuilder` の各ignore系フラグに反映される
- **対応US**: US-002

### T-003: Rustテストの更新・追加 ✅

- **依存**: T-001
- **完了条件**:
  - [x] 既存テスト（verbatimプレフィックス・ソート・隠しファイル）を新実装で通す
  - [x] 1階層のみ返すこと・`children: None` のテスト
  - [x] 拡張子フィルターのテスト（ディレクトリは残ること含む）
  - [x] gitignore有効/無効の除外テスト
  - [x] サブフォルダ起点の走査に親の.gitignoreが適用されるテスト（遅延読み込みの要）

---

## Phase 2: フロントエンド

### T-004: 遅延読み込みアクションとストア拡張 ✅

- **依存**: T-001
- **概要**: `actions/explorer-actions.ts` を新設し、`stores/explorer.svelte.ts` に `setChildren` / `loadingDirs` を追加する
- **完了条件**:
  - [x] 展開時に `children` 未取得なら `read_directory` を呼んでツリーへ差し込む
  - [x] 読み込み中の二重取得が `loadingDirs` で防がれる
  - [x] `openFolder`（`dialog-actions.ts`）がルート1階層のみ取得する
  - [x] `FileTree.svelte` が読み込み中表示を出す
- **対応US**: US-001

### T-005: 設定トグル「.gitignoreを考慮」 ✅

- **依存**: T-004
- **完了条件**:
  - [x] `respectGitignore`（デフォルトON）が設定に追加され永続化される
  - [x] 設定パネルにトグルが表示され、変更時にツリーが再読み込みされる
  - [x] 全文検索の呼び出しにも設定値が渡される
- **対応US**: US-002

### T-006: 拡張子フィルターのRust側への一本化 ✅

- **依存**: T-001
- **完了条件**:
  - [x] `FileTree.svelte` のフロント側拡張子フィルターを削除
- **対応US**: US-001

---

## Phase 3: 検証

### T-007: 実アプリでのE2E確認 ✅

- **依存**: T-001〜T-006
- **完了条件**:
  - [x] markdown-viewerルート（5.2万ファイル）が十数msで開く
  - [x] サブフォルダ展開の遅延読み込みが動作し `node_modules` が表示されない
  - [x] トグルOFFで `node_modules` / `.svelte-kit` / `build` が表示され、ONで消える
  - [x] 全文検索がエラーなく動作する
  - [x] cargo test / clippy / eslint / svelte-check / vitest がすべてクリーン
