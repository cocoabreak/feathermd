# 実装タスク: 文字数・読了時間の表示 (reading-stats)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: コアロジック

### T-001: reading-stats.ts の新規作成 ✅

- **依存**: なし
- **概要**: `computeReadingStats(container)` を実装する
- **完了条件**:
  - [x] `pre`・`svg`（コードブロック・Mermaid図）を除いた文字数を計算する
  - [x] CJK文字比率30%以上で文字数ベース、未満で単語数ベースの読了時間を算出する
  - [x] 本文が空（コード/図のみ含む）の場合は`null`を返す
  - [x] 単体テスト（`reading-stats.test.ts`）でCJK判定・単語判定・コードブロック除外を検証する
- **対応US**: US-001, US-002

---

## Phase 2: 状態管理・UI統合

### T-002: reading-stats.svelte.ts ストアの新規作成 ✅

- **依存**: T-001
- **概要**: `readingStatsStore`を追加する
- **完了条件**:
  - [x] `stats` getterと`set()`が実装されている
- **対応US**: US-001

### T-003: MarkdownViewer.svelte / StatusBar.svelte への組み込み ✅

- **依存**: T-002
- **概要**: 後処理effectで`computeReadingStats`を呼び`readingStatsStore`にセットし、`StatusBar.svelte`で表示する
- **完了条件**:
  - [x] コンテンツ再レンダリング時に`readingStatsStore`が更新される
  - [x] タブなし・本文なし時に表示されない
  - [x] ステータスバーに「文字数/words · 約n分」形式で表示される
- **対応US**: US-001, US-002

---

## Phase 3: 品質確認

### T-004: 動作確認 ✅

- **依存**: Phase 2完了
- **概要**: 実アプリで日本語ファイル・英語ファイルそれぞれの表示を確認する
- **完了条件**:
  - [x] 日本語中心のファイルで「n字 · 約n分」が表示される（`/run-feathermd`で実測: `1,558字 · 約4分`）
  - [x] 英語中心のファイルで「n words · 約n分」が表示される（実測: `186 words · 約1分`、コードブロック中の単語が含まれないことも確認）
  - [x] コードブロックが多いファイルでも、コード部分が文字数に含まれていないことを確認する
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: 全US
