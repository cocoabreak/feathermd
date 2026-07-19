# 外部画像プライバシー 技術設計

## ステータス

完了

## 方針

`sanitizeHtml`後、`{@html}`でDOMへ挿入する前のHTML文字列を`protectExternalImages`へ通す。確認前のURLを`data-external-*`属性へ退避し、通信を起こす属性を除去する。DOM挿入後の属性除去ではWebViewが先に取得を開始しうるため採用しない。

設定値は`ExternalImagePolicy = "block" | "ask" | "allow"`とし、既定値を`ask`にする。`MarkdownViewer`は設定値と、モジュール内の実行時限定パス許可を使って、レンダリング結果を保護するか判断する。

## コンポーネント

### `markdown/external-images.ts`

- HTMLをtemplate要素で解析し、外部画像参照を検出・退避する純粋変換を提供する。
- URL判定は前後空白を除去し、`http:`、`https:`、`//`を対象とする。
- `srcset`は個別解析せず、外部URLを含む値全体を退避する。data URL中のカンマを誤解析しないためである。
- CSSエスケープを安全に判定できないため、`url()`または`image-set()`を含むstyle属性全体を退避し、style要素はサニタイズで禁止する。
- style属性は外部URLを含む場合に属性全体を退避する。
- 変換結果としてHTMLとブロック件数を返す。

### `stores/external-image-permission.ts`

- 許可済み文書パスを通常の`Set`で保持する。
- 永続化しない。watcher再描画では同じパスなので許可が維持される。

### `MarkdownViewer.svelte`

- Markdownレンダリング完了時に、ポリシーと一時許可のスナップショットでHTMLを変換する。
- `ask`かつブロック件数ありの場合のみ、本文上部に非モーダル通知を表示する。
- 許可ボタンはパスを実行時ストアへ追加し、再レンダリングして元URLを含むHTMLを挿入する。
- `block`は通知・許可操作なし、`allow`は変換なしとする。

### 設定・i18n

- 既存設定ストア、保存処理、設定パネルへ選択肢を追加する。
- 未保存の旧設定は`ask`、未知値は読み捨てる。

## セキュリティ

- CSPの`img-src https:`は許可後の表示に必要なため維持し、アプリ側でfail-closedに保護する。
- sanitizer通過後に生成する退避属性はHTMLとして再解釈せず、ブラウザーDOM APIでシリアライズする。
- `style`内の外部URLは完全なCSS解析を避け、安全側にstyle属性全体を保護する。
- セーフモードはHTMLを生成しないため、この許可経路の対象外とする。

## テスト

- 外部URL属性、srcset、SVG、style、プロトコル相対URLの事前除去。
- local/data URLの維持、allow時の無変換。
- 設定値の既定・更新、および文書パス単位の一時許可。
- 設定パネルと通知UIは型検査および実アプリで確認する。
