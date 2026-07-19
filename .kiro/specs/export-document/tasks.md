# 実装タスク: エクスポート機能

> **注**: 2026-07-10のspecステータス整理で実態に合わせて更新。2026-07-11にPDF出力（印刷）を実装し完了。

- [x] 印刷用CSS (`@media print`) の整備（UI要素の非表示、改ページ制御など） → `app.css` の `@media print` ブロック（スクロールレイアウト解除・改ページ制御・コード配色保持）＋各UIコンポーネントの `print:hidden`
- [x] `window.print()` を呼び出すアクションの実装 → `printDocument()`（`export-actions.ts`）。印刷前にプラグインの `beforePrint` フックを待ち、画面外で遅延中のMermaid図を即時レンダリングしてから印刷する。ダークテーマ時は印刷中のみライトへ切替。導線はコンテキストメニュー・コマンドパレット・ネイティブメニュー「ファイル > 印刷 / PDFとして保存...」の3系統（`Ctrl+P`はクイックオープンへ再割当）
- [x] HTML文字列の生成とファイル保存処理の実装 → `saveAsHtml()`（`export-actions.ts`）。スタンドアロンHTMLとして基本CSSを埋め込んで保存。加えてMermaid図のSVG/PNG保存（`saveAsSvg` / `saveAsPng`）も実装
- [x] UI（メニュー・ボタン）へのエクスポート導線の追加 → コンテンツ領域のコンテキストメニュー「HTMLとして保存...」「印刷 / PDFとして保存...」（SVG上では「画像を保存 (PNG/SVG)...」も表示）
- [x] HTML/SVG/PNG保存をRustネイティブコマンドへ移行し、保存先パスをWebViewへ返さない
- [x] `tauri-plugin-fs` と `fs:*` capabilityを削除し、形式・拡張子・候補名・64 MiB上限をRust側で検証する
- [x] ネイティブダイアログの同時表示を既存 `NativeDialogState` で拒否する
- [x] PNG Canvasの次元・総画素数を生成前に制限する
- [x] PNG保存がCSPで失敗する不具合の修正 → SVGの`<img>`読み込みをblob URLからdata: URLへ変更（CSPの `img-src` は `blob:` を許可しておらず、CSPは緩めずに済ませる）。あわせてMermaid SVGが固有サイズを持たない場合に備え、表示実寸をラスタライズサイズとして明示
