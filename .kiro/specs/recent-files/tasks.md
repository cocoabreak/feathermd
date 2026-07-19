# 実装タスク: 最近開いたファイル・フォルダー (recent-files)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: 状態管理・永続化

### T-001: recent.svelte.ts ストアの新規作成 ✅

- **依存**: なし
- **概要**: `recentStore`（`files`/`folders`、`addFile`/`addFolder`/`setAll`）を実装する
- **完了条件**:
  - [x] 同じパスを追加すると重複せず先頭に移動する
  - [x] 最大10件を超えると古いものから切り捨てられる
- **対応US**: US-001, US-002

### T-002: recent-store.ts（永続化）の新規作成 ✅

- **依存**: T-001
- **概要**: `recent.json`への`loadRecent`/`saveRecent`を実装する
- **完了条件**:
  - [x] `loadRecent()`で保存済みの`files`/`folders`が`recentStore`に反映される
  - [x] `saveRecent()`で現在の`recentStore`の内容がディスクに保存される
- **対応US**: US-003

---

## Phase 2: 記録フックの組み込み

### T-003: openMarkdownFile への記録追加 ✅

- **依存**: T-002
- **概要**: `file-actions.ts`の`openMarkdownFile`内で`recentStore.addFile`+`saveRecent`を呼ぶ
- **完了条件**:
  - [x] ダイアログ・サイドバーのファイルツリー・本文中のリンク遷移いずれの経路でファイルを開いても記録される
- **対応US**: US-001

### T-004: openFolder の切り出しと記録追加 ✅

- **依存**: T-002
- **概要**: `dialog-actions.ts`から`openFolder(path)`を切り出し、`openFolderDialog`から呼ぶ形にする。`openFolder`内で`recentStore.addFolder`+`saveRecent`を呼ぶ
- **完了条件**:
  - [x] `openFolderDialog`が`openFolder(path)`を呼ぶ形にリファクタリングされている
  - [x] フォルダを開くたびに記録される
- **対応US**: US-002

---

## Phase 3: UI統合

### T-005: Sidebar.svelte（フォルダー空状態）への一覧表示 ✅

- **依存**: T-004
- **概要**: フォルダー未オープン時、`recentStore.folders`があれば一覧表示しクリックで`openFolder`を呼ぶ
- **完了条件**:
  - [x] 一覧がない場合は従来通り「フォルダを開いてください」が表示される
  - [x] 一覧がある場合はクリックでフォルダが開く
- **対応US**: US-002

### T-006: MarkdownViewer.svelte（ファイル空状態）への一覧表示 ✅

- **依存**: T-003
- **概要**: ファイル未オープン時、`recentStore.files`があれば一覧表示しクリックで`openMarkdownFile`を呼ぶ
- **完了条件**:
  - [x] 一覧がない場合は従来通り「ファイルを開いてください」が表示される
  - [x] 一覧がある場合はクリックでファイルが開く
- **対応US**: US-001

### T-007: +page.svelte への起動時ロード組み込み ✅

- **依存**: T-002
- **概要**: `onMount`で`loadRecent()`を呼ぶ
- **完了条件**:
  - [x] アプリ起動時に保存済みの一覧が復元される
- **対応US**: US-003

---

## Phase 4: 品質確認

### T-008: 動作確認 ✅

- **依存**: Phase 3完了
- **概要**: 実アプリでファイル・フォルダそれぞれの記録・再オープン・再起動後の永続化を確認する
- **完了条件**:
  - [x] ファイルを開くと空状態の一覧に反映される
  - [x] フォルダを開くと空状態の一覧に反映される
  - [x] 同じファイル/フォルダを再度開いても一覧内で重複しない
  - [x] アプリ再起動（driver.mjsでのquit→launch）後も一覧が保持されている
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: 全US
