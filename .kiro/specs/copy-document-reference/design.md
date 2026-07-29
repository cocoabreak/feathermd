# 技術設計: 文書・見出し参照のコピー

## ステータス

設計完了

## 1. 全体構成

参照文字列生成を`lib/reference-copy.ts`の純粋関数へ集約する。入力は信頼済みの
`DocumentRef`、`DocumentSourceInfo`、文書タイトル、任意の`TocHeading`とし、DOM属性や
Markdown本文からDocumentRefを復元しない。

```text
MarkdownViewer context menu ─┐
TOCView context menu ─────────┼─> reference-copy menu ─> formatReference ─> Clipboard API
Command Palette ──────────────┘                                      │
                                                               feedback store
                                                                     │
                                                             MarkdownViewer通知
```

## 2. 参照形式

文書`docs/guide.md`、表示名`guide`、見出し`設定`、アンカーID`設定`の場合:

| 形式 | 出力 |
|---|---|
| Wikiリンク | `[[docs/guide.md]]` |
| 見出し付きWikiリンク | `[[docs/guide.md#設定]]` |
| Markdownリンク | `[guide](</docs/guide.md>)` |
| 見出し付きMarkdownリンク | `[guide — 設定](</docs/guide.md#設定>)` |
| ファイルパス | Nativeは絶対パス、ZIPは`archive.zip / docs/guide.md` |
| 見出し名 | `設定` |

Markdownリンクの先頭`/`はOSルートではなくDocumentSourceルートを表す。Windowsの
`C:/...`と`//server/...`は従来どおりネイティブ絶対パスとして区別する。

文書表示名は`document.path`のbasenameから`.md`または`.markdown`を大文字小文字無視で
除去する。frontmatterやH1はファイル更新で変化し得るため初期版では使用しない。

## 3. Sourceルートリンク解決

フロントの`resolveDocumentTarget`と受動処理用`resolveSourceRelativeMarkdownTarget`へ、
単一`/`で始まるターゲットをSourceルートから正規化する処理を追加する。NUL、ルートを越える
`..`、ドライブ絶対パス、UNC、URIは既存どおり拒否する。

Rustのリンク索引`resolve_markdown_link`も単一`/`をSourceルートとして解決する。これにより、
コピーしたリンクを別階層の文書へ貼っても、本文遷移、リンクプレビュー、出力・入力・問題一覧が
同じDocumentRefを指す。

## 4. 見出しアンカー

現在は`toc-dom.ts`がASCIIの`\w`だけを残す一方、`link-preview.ts`はUnicode文字・数字を残すため、
日本語見出しとプレビューで規則が一致していない。共通のアンカー正規化関数を
`markdown/heading-anchor.ts`へ抽出し、以下へ適用する。

- `buildToc`: DOMへ一意なIDを付与する
- `scrollToAnchor`: percent decode、完全一致、正規化比較を行う
- `link-preview`: 見出し探索に同じbase slugを使う

基本slugはNFKC正規化、小文字化、Unicodeの文字・数字・空白・ハイフンを保持し、記号を除去、
空白を`-`へ変換する。空の場合だけ`heading-{index}`を使う。重複時は`-1`、`-2`を付ける。

コピーにはTOCが保持する実際の`heading.id`を使用するため、重複見出しも一意に参照できる。

## 5. 操作導線

### MarkdownViewer

既存ビューアコンテキストメニューへ「参照をコピー」サブメニューを追加する。本文上では文書の
3形式、`h1..h6`内では文書形式に加えて見出しの3形式を表示する。SVG保存、HTML保存、印刷、
外部エディター等の既存項目は維持する。

### TOCView

各目次ボタンの`contextmenu`で見出し用3形式を持つネイティブメニューを表示する。キーボードの
コンテキストメニュー操作でも同じイベント経路を使う。

### コマンドパレット

現在タブにDocumentRefとSourceがある場合だけ、文書Wikiリンク、文書Markdownリンク、パスの
3コマンドを表示する。見出しは明示選択が必要なためコマンドパレットへ追加しない。

## 6. コピーと通知

`navigator.clipboard.writeText`をメニュー選択またはコマンド実行時に呼ぶ。成功・失敗は
`reference-copy`用の一時状態へ格納し、MarkdownViewer下部の非モーダル表示と`aria-live`で
通知する。一定時間後に自動消去し、連続コピーではタイマーを更新する。

メニュー生成失敗は既存コンテキストメニューと同様にログへ記録し、本文表示を維持する。

## 7. セキュリティ

- DocumentRefとSourceは現在タブまたはTOCに対応するメモリ上stateから渡す
- DOMからは見出しID、表示文字列、レベルだけを取得し、パスやSource IDを取得しない
- パス形式は明示的に選択された場合だけ生成する
- 生成文字列を`innerHTML`や`{@html}`へ渡さない
- Sourceルート解決は正規化後に`..`でルートを越えない
- リンクを開く際は既存のRust側SourceRegistryとAllowedRoots検証を通る
- ZIP表示パスは表示用であり、OSから直接開けるパスとは扱わない

## 8. 検証

- 文書名、`.md`／`.markdown`、空白、Unicode、Markdownラベル記号の文字列生成テスト
- 文書・見出しの全6形式とNative／ZIPパス形式のテスト
- Unicode、記号のみ、重複、既存IDを含む見出しslugテスト
- Sourceルート、相対、`..`、ドライブ、UNC、URIのフロント解決テスト
- Native／ZIPのRustリンク索引でSourceルート解決テスト
- コンテキストメニューの表示条件を純粋関数またはモックでテスト
- コマンドパレットの表示条件とコピー実行テスト
- Clipboard API成功・失敗と通知タイマーのテスト
- 実WebView2で本文、見出し、TOC、コマンドパレットからコピーし、貼り戻したリンク遷移を確認
