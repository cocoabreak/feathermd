# 実装タスク: frontmatter（YAML）のメタデータ表示 (frontmatter-display)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: コアロジック

### T-001: frontmatter.ts の新規作成 ✅

- **依存**: なし
- **概要**: `extractFrontmatter(raw)` を実装する（`js-yaml`依存追加を含む）
- **完了条件**:
  - [x] ファイル先頭の`---`〜`---`ブロックを検出しYAMLとして解析する
  - [x] 本文中の水平線（`---`）を誤ってfrontmatterと認識しない
  - [x] 解析失敗時・マッピング以外の場合は`data: null`、`content`は元のまま返す
  - [x] 単体テストで検出・除外・不正YAML・frontmatterなしのケースを検証する
- **対応US**: US-001, US-002

### T-002: engine.ts への組み込み ✅

- **依存**: T-001
- **概要**: `renderMarkdown`の戻り値を`{ html, frontmatter }`に変更する
- **完了条件**:
  - [x] `extractFrontmatter`で除外した本文のみが`md.render()`に渡される
  - [x] キャンセル時は`{ html: "", frontmatter: null }`を返す
- **対応US**: US-001

---

## Phase 2: 状態管理・UI統合

### T-003: frontmatter.svelte.ts ストアの新規作成 ✅

- **依存**: T-002
- **概要**: `frontmatterStore`を追加する
- **完了条件**:
  - [x] `data` getterと`set()`が実装されている
- **対応US**: US-001

### T-004: MarkdownViewer.svelte への組み込み ✅

- **依存**: T-003
- **概要**: レンダリング結果から`frontmatterStore`を更新する
- **完了条件**:
  - [x] レンダリング完了時に`frontmatterStore.set(result.frontmatter)`が呼ばれる
  - [x] タブなし・本文なし時に`null`にリセットされる
- **対応US**: US-001

### T-005: TOCPanel.svelte への表示追加 ✅

- **依存**: T-004
- **概要**: TOCパネル上部に折りたたみ可能なメタデータセクションを追加する
- **完了条件**:
  - [x] frontmatterがある場合のみセクションが表示される
  - [x] キー:値の一覧が表示される
  - [x] 配列値（文字列/数値のみ）はpill表示される
- **対応US**: US-001

---

## Phase 3: 品質確認

### T-006: 動作確認 ✅

- **依存**: Phase 2完了
- **概要**: 実アプリでfrontmatterあり/なし/不正YAMLそれぞれの表示を確認する
- **完了条件**:
  - [x] frontmatterがあるファイルでメタデータセクションが表示され、tags等がpill表示される
  - [x] frontmatterがないファイルでセクションが表示されない
  - [x] frontmatterブロックが本文として（水平線等で）誤表示されない
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: 全US
