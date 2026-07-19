# 技術設計: エクスポート機能

## ステータス

完了（2026-07-19。HTML/SVG/PNG保存をRustネイティブコマンドへ移し、WebViewのファイル書込権限を削除）

## アーキテクチャ

- **PDF出力**:
  - ブラウザの印刷機能（`window.print()`）を利用し、印刷ダイアログから「PDFとして保存」させるアプローチ（最もシンプル）。
  - カスタムの印刷用CSS (`@media print`) で、サイドバー等のUI要素を隠し（各コンポーネントの `print:hidden`）、固定高のスクロールレイアウトを通常のブロックフローへ解除して全文を出力する（`app.css` の `.print-expand`）。改ページ制御（見出し直後・ブロック要素内での改ページ回避）もここで行う。
  - 遅延レンダリング対策として、プラグインインターフェースに `beforePrint(container, context)` フックを追加。印刷アクション（`printDocument()`）は全プラグインのbeforePrintを待ってから `window.print()` を呼ぶ。Mermaidはこのフックで画面外の未描画図を即時レンダリングする。
  - ダークテーマのまま印刷すると白地に薄色文字となるため、印刷ダイアログ表示中のみ `documentElement` の `dark` クラスを外してライトテーマで出力する。
  - 導線: コンテンツ領域のコンテキストメニュー / コマンドパレット（コマンド`export.print`）/ ネイティブメニュー「ファイル > 印刷 / PDFとして保存...」。`Ctrl+P`はquick-open-command-palette specでクイックオープンへ再割当した。
- **HTML出力**:
  - 現在レンダリングされている `innerHTML` と、必要なCSS（styleタグ）を結合して単一のHTMLファイル文字列を生成。
  - WebViewは生成内容と形式、候補ファイル名だけを `save_text_export` へ渡す。保存ダイアログと書き込みはRustが行い、保存先パスはWebViewへ返さない。
- **SVG/PNG出力**:
  - SVGはXML文字列を `save_text_export`、PNGはCanvasで生成したバイト列を `save_binary_export` へ渡す。
  - PNGはCanvas確保前に一辺16,384px・総25,000,000画素を上限として検証し、WebViewの過大なメモリ消費を防ぐ。
  - Rustはテキスト形式をHTML/SVG、バイナリ形式をPNGに限定し、選択パスの拡張子が確定形式と一致しなければ書き込まず拒否する。候補名からパス区切り・制御文字・OSで無効な文字を除去する。
- **ファイル書き込み権限**:
  - `tauri-plugin-fs` と `fs:*` capabilityは使用しない。共有 `NativeDialogState` で同時ダイアログを拒否し、ユーザーがその場で選択した保存先へRustが一度だけ書き込む。
  - 文字列・バイト列とも64 MiBを上限とし、Rust側で書き込み前に検証する。
