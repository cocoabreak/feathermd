# 技術設計: Markdownソース確認モード

## ステータス

完了

## 1. 状態モデル

`Tab`へ次の任意フィールドを追加する。

```ts
type ViewMode = "rendered" | "source";
viewMode?: ViewMode;
```

未指定は`rendered`として扱い、既存タブ生成・復元データとの互換性を保つ。`renderMode`は大容量文書の`full | safe`専用として維持し、表示目的の`viewMode`と混在させない。今回`tabs.json`には保存しない。

## 2. 切替経路

表示切替の本体を`actions/view-actions.ts`へ置き、ステータスバーと`view.toggleSource`コマンドが共有する。アクティブタブが通常表示（renderMode=full）の場合だけ切替可能とする。

ステータスバーには現在値「レンダー」または「ソース」を表示し、ボタンのtitle/aria-labelには切替先を明記する。将来のコマンドパレットは同じcommand idを利用する。

## 3. ソース描画

`SourceView.svelte`は`contentStore.raw`をSvelteの通常テキスト補間で`pre`へ描画する。`{@html}`、Markdownパーサー、DOMPurify、レンダラープラグインは通さない。コピーは`navigator.clipboard.writeText(raw)`をユーザー操作時だけ呼ぶ。

安全なTOCを維持するため、Rustが読込時に返した`SafeOutlineHeading.utf16Offset`で文字列を分割し、見出し位置に既存の安全なIDを持つ空アンカーを置く。この分割処理は大容量`SafeModeView`と共有する。

従来safeOutlineは大容量確認対象だけで生成していたが、本機能では通常文書にも必要になる。ネイティブFS/ZIPが共有する`build_markdown_content`で、最大2,000見出しに制限された既存抽出処理を全Markdownへ適用する。

## 4. MarkdownViewer統合

```text
renderMode=safe
  → 既存SafeModeView

renderMode=full, viewMode=source
  → SourceView

renderMode=full, viewMode=rendered/undefined
  → 既存Markdownレンダリング
```

ソース時はレンダリングeffectを開始せず、engineのレンダリング世代を進めてawait中の旧レンダリングを同期HTML生成前にキャンセルする。既存のプラグイン、画像、コードコピー等のDOM後処理もcleanupする。TOCはsafeOutline、frontmatterと読了時間は未表示とする。ページ内検索はSourceViewのテキストDOMとrawを既存検索処理へ渡す。

スクロール位置キーを`tab id + rendered/source/safe`にして、同じタブ内で切り替えても各表示位置を保持する。

ソース全文コピーとのUI整合のため、レンダー表示のコードブロックもコピー成功時だけチェックアイコンと完了メッセージを1.5秒表示する。通常時は従来どおりアイコンだけとし、翻訳済みラベルを`setupCodeCopy`へ渡して表示・title・aria-labelを同期する。

## 5. コンテキストメニューと安全性

コンテキストメニューへ`viewMode`を渡し、ソース時はSVG保存とHTML保存を除外する。印刷、Copy、Select All、外部エディターは維持する。

新しいRustコマンド、filesystem権限、Tauri capability、外部通信は追加しない。rawは既存のサイズ制限・AllowedRoots・ZIP検証を通過した内容だけを使用する。
