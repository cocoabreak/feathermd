# 実装タスク: コードブロックコピー (code-copy)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: コアロジック

### T-001: code-copy.ts の新規作成 ✅

- **依存**: なし
- **概要**: `setupCodeCopy(container)` を実装し、`pre.shiki` をラップしてコピーボタンを注入する
- **完了条件**:
  - [x] `pre.shiki` を `.code-block-wrapper` でラップする
  - [x] ボタンクリックで `pre内code`の`textContent`を`navigator.clipboard.writeText`へ渡す
  - [x] コピー成功時、アイコンがCHECKに切り替わり1500ms後に戻る
  - [x] クリップボード書き込み失敗時、`console.warn`のみでクラッシュしない
- **対応US**: US-001, US-002

---

## Phase 2: UI統合

### T-002: MarkdownViewer.svelte への組み込み ✅

- **依存**: T-001
- **概要**: レンダリング後の`$effect`で`setupCodeCopy`を呼び出し、コピーボタン用のCSSを追加する
- **完了条件**:
  - [x] コンテンツ再レンダリング時に`setupCodeCopy(contentEl)`が呼ばれる
  - [x] `.code-block-wrapper`にホバーするとボタンが表示される（通常時は非表示）
  - [x] コードブロックを横スクロールしてもボタンが右上に固定表示される
- **対応US**: US-001

---

## Phase 3: 品質確認

### T-003: 動作確認 ✅

- **依存**: Phase 2完了
- **概要**: 実際のMarkdownファイルでコピー動作を確認する
- **完了条件**:
  - [x] 複数言語（js/rust/bash等）のコードブロックでコピーボタンが表示され、正しいテキストがコピーされる（実CSS+実DOM構造でのヘッドレスブラウザ実測で確認）
  - [x] Mermaidダイアグラムにはコピーボタンが表示されない（対象外であることの確認）
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: 全US
