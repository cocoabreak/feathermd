# 実装タスク: ファイル内検索 (in-file-search)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: 検索ロジック

### T-001: search-highlight.ts の実装 ✅

- **依存**: なし
- **概要**: `app/src/lib/markdown/search-highlight.ts` を新規作成する
- **完了条件**:
  - [x] `clearHighlights(container)` が既存の `mark.search-match` を取り除きテキストノードに戻す
  - [x] `applyHighlights(container, query, useRegex)` がリテラル検索・正規表現検索の両方に対応する
  - [x] 大文字小文字を区別しない（`i` フラグ常時付与）
  - [x] 不正な正規表現入力時は例外を投げず `{ marks: [], error: string }` を返す
  - [x] 空文字マッチ（例: `a*`）で無限ループしない
  - [x] 単体テスト（jsdom環境）: リテラル一致・正規表現一致・大文字小文字無視・不正な正規表現・マッチなし・複数マッチのケースがある
- **対応US**: US-001, US-003

### T-002: search.svelte.ts の実装 ✅

- **依存**: なし
- **概要**: `app/src/lib/stores/search.svelte.ts` を新規作成する
- **完了条件**:
  - [x] `open` / `query` / `useRegex` / `matchCount` / `currentIndex` / `error` のgetterがある
  - [x] `openSearch` / `closeSearch` / `setQuery` / `toggleRegex` / `setResult` / `next` / `prev` が実装されている
  - [x] `next()` / `prev()` はマッチ0件時に何もしない、それ以外は先頭/末尾をまたいでループする
  - [x] `closeSearch()` は `query` を保持したまま `open` / `matchCount` / `currentIndex` / `error` をリセットする
  - [x] （設計からの追加）`navVersion` カウンタを追加。`next()`/`prev()`でのみ増分し、`setResult()`によるcurrentIndexリセットと区別してジャンプ要否を判定できるようにした
- **対応US**: US-001, US-002, US-004

---

## Phase 2: UI統合

### T-003: SearchBar.svelte の実装 ✅

- **依存**: T-002
- **概要**: `app/src/lib/components/SearchBar.svelte` を新規作成する
- **完了条件**:
  - [x] マウント時に検索欄へフォーカスする
  - [x] 入力を150msデバウンスして `searchStore.setQuery()` に反映する
  - [x] 正規表現トグルボタンで `searchStore.toggleRegex()` を呼ぶ
  - [x] マッチ件数（`n/m`）またはエラー時「無効」、0件時「0/0」を表示する
  - [x] 次候補/前候補ボタンがマッチ0件のとき無効化される
  - [x] `Escape` で `searchStore.closeSearch()` を呼ぶ（ローカルkeydownハンドラ）
  - [x] `Enter` で次候補、`Shift+Enter` で前候補に移動する
- **対応US**: US-001, US-002, US-003
- **既知の制約**: 検索欄にフォーカス中はグローバルショートカット（`Ctrl+Tab`等）が発火しない（既存のinput focusガードによる仕様どおりの挙動。フォーカス優先度の整理は`.kiro/backlog.md`で管理）

### T-004: MarkdownViewer.svelteへのハイライト統合 ✅

- **依存**: T-001, T-002, T-003
- **概要**: ハイライト適用・現在地更新の2つの `$effect` を追加し、`SearchBar` をオーバーレイ表示する
- **完了条件**:
  - [x] コンテンツ領域が `relative` ラッパーで囲まれ、`{#if searchStore.open}` で `SearchBar` がオーバーレイ表示される
  - [x] 検索語・正規表現モード・開閉・`renderedHtml` 変更のいずれかで再走査するeffectがある
  - [x] `navVersion`（`currentIndex`ではなく）変更のみで再走査せずクラス付け替え・スクロールするeffectがある（設計変更: `currentIndex`を直接見ると、再走査由来のリセットと`next()`/`prev()`によるユーザー操作を区別できず、後者が正しく動かない不具合が発生したため）
  - [x] `.search-match` / `.search-match-current` のスタイルが定義されている
  - [x] 既存の後処理effect（スクロール復元・TOC構築・Mermaid・画像変換）に検索関連の依存を追加しない（無関係な再実行を避ける）
  - [x] （設計変更: US-004実装時のUX相談を踏まえ）タブ切り替えによる再走査ではハイライト・件数のみ更新し、ビューはスクロールしない。ジャンプは検索語/正規表現/開閉の変更時と`next()`/`prev()`操作時のみ行う（既存のタブごとのスクロール位置復元機能と競合しないようにするため）
- **対応US**: US-001, US-002, US-004
- **副産物の修正**: 実装過程で、タブ切り替え時にスクロール位置が保持されない既存の不具合（本機能とは無関係、`main`でも再現）を発見し、別ブランチ`fix/tab-switch-scroll-position`で修正・マージ済み

### T-005: キーボードショートカット登録 ✅

- **依存**: T-002
- **概要**: `Ctrl+F` で検索バーを開けるようにする
- **完了条件**:
  - [x] `keymap.ts` に `"Ctrl+F": "search.open"` を追加
  - [x] `builtin.ts` に `search.open` コマンドを登録する
  - [x] 検索欄にフォーカスがある間は `Ctrl+F` の再押下がグローバルショートカットとして発火しない（既存のinput/textareaガードを利用）
- **対応US**: US-001

---

## Phase 3: 品質確認

### T-006: 動作確認 ✅

- **依存**: Phase 2完了
- **概要**: 開発環境・実機での動作確認とコード品質チェック
- **完了条件**:
  - [x] リテラル検索・正規表現検索それぞれでハイライト・マッチ件数表示が正しい
  - [x] 次候補/前候補ボタン・Enter/Shift+Enterでのループ移動が正しい
  - [x] コードブロック・表のセル内のテキストも検索対象になる
  - [x] タブを切り替えると新しいアクティブタブに対してハイライト・件数が自動更新される（ジャンプはしない。US-004参照）
  - [x] 不正な正規表現でクラッシュせずエラー表示になる
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: 全US
