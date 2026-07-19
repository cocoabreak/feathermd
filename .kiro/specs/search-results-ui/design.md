# 検索結果UI 技術設計

## ステータス

完了

## 方針

既存の検索Workerを共通のテキスト配列検索として再利用する。本文ハイライトは描画DOMのテキストノード配列、一覧はMarkdownソースの行配列を入力する。両者とも`MAX_SEARCH_MATCHES = 500`で打ち切る。

## 構成

### `markdown/search-highlight.ts`

- テキスト配列から一致範囲を返す処理を`findTextMatches`として公開する。
- リテラル・正規表現の双方で呼び出し側から上限を渡す。
- `applyHighlights`は上限500件で既存DOMへ`mark`を作る。

### `markdown/search-results.ts`

- Markdownソースを改行単位に分割し、`findTextMatches`へ渡す。
- 各一致から`line`、`before`、`match`、`after`を生成する。
- 前後文は一致の周囲最大80文字ずつとし、1項目の描画量を制限する。

### `stores/search.svelte.ts`

- `results`と`truncated`を検索状態として保持する。
- 一覧選択は`currentIndex`を更新し、行移動要求のバージョンを増やす。

### `SearchBar.svelte`

- 既存のコンパクトな操作列と、その下の最大高さを持つ結果一覧で構成する。
- 一覧開閉ボタンを追加し、結果は通常のbutton要素としてキーボード操作可能にする。

### `MarkdownViewer.svelte`

- 検索条件・生Markdown・タブ変更時に一覧データを非同期生成する。
- 一覧選択時は`data-source-line`が最も近いmark群を選ぶ。Markdownの連続行が1段落へまとまり複数markが同じ開始行を持つ場合は、そのソース範囲内での結果順を使ってmarkを決定する。行情報がない場合だけ全体の一致順へフォールバックする。

## 上限の判断

仮想化なしで5,000件の結果ボタンと5,000個の`mark`を生成すると、検索語入力ごとのDOM更新とレイアウト負荷が大きい。500件なら最悪時のDOM増加を約1,000要素に制限できる。正確な総件数より応答性を優先し、上限到達時は`500+`として扱う。
