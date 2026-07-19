# 技術設計: カスタムCSS (custom-css)

## ステータス

完了

## 適用境界

ユーザーCSSをPostCSSで解析し、通常のセレクタへ`.markdown-body`を付与する。すでに`.markdown-body`で始まるセレクタは二重に付与しない。`@media`内も変換し、`@keyframes`は変更しない。`@import`と宣言値中の`url()`はエラーにする。

変換済みCSSは`<style id="custom-user-css">`として`document.head`末尾へ挿入し、既定スタイルより後からカスケードさせる。印刷時にも同じCSSを適用する。

## 状態とライフサイクル

- `Settings`: `customCssEnabled`, `customCssPath`
- `custom-css.ts`: 読み込み、検証、スコープ変換、style反映、監視切替、実行時エラーを一元管理
- 起動時: 設定ロード後にCSSを読み込み、監視開始
- 設定変更時: 旧監視解除、CSS再適用、新監視開始
- ファイル変更時: `custom-css-changed`イベントで再読み込み
- 無効化・解除時: style要素と監視を除去

CSSの読み込みは、明示選択時および保存設定の復元時に`register_root`で親フォルダを信頼済みルートへ登録した後、Rustの専用コマンドで拡張子・サイズ・信頼境界を検証して行う。

## プラグイン規約

fence型プラグインのプレースホルダーに以下を付与する。

```html
<div class="viewer-plugin viewer-plugin--mermaid" data-viewer-plugin="mermaid"></div>
```

KaTeXは`.markdown-body`配下の`.katex`をCSS契約とする。Mermaid内部SVGの完全なテーマ変更とShikiのトークン色変更は保証せず、既存の専用テーマ設定を優先する。
