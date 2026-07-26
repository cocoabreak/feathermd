---
title: リンク機能デモ
aliases:
  - Link Demo
  - リンク確認
tags:
  - feather-md
  - sample
---

# リンク機能デモ

このフォルダーは、リンクインスペクター、ローカルリンクグラフ、リンク先プレビューの
動作確認に使用するサンプルです。このファイルを最初に開いてください。

## 解決できるリンク

- Wikiリンク: [[setup|セットアップガイド]]
- 見出し付きWikiリンク: [[details#制限事項|詳細の制限事項]]
- Markdownリンク: [用語集](reference/glossary.md)
- 見出し付きMarkdownリンク: [プレビュー対象](guide/details.md#プレビュー対象)
- 同名ファイルの近接解決: [[overview]]

## リンク切れ

- 存在しないWikiリンク: [[missing-page|未作成ページ]]
- 存在しないMarkdownリンク: [存在しない文書](missing/document.md)

## 索引対象外の例

- 外部リンク: [FeatherMD on GitHub](https://github.com/cocoabreak/feathermd)
- 画像: ![存在しないサンプル画像](assets/missing.png)
- 同一文書内リンク: [確認ポイント](#確認ポイント)
- インラインコード: `[[not-a-link]]` と `[not a link](missing.md)`

```markdown
[[code-block-link]]
[code block link](missing.md)
```

<a href="guide/setup.md">生HTML内のリンク</a>

## 確認ポイント

リンク一覧では、解決済みリンク、リンク切れ、WikiリンクとMarkdownリンクの種別を
見分けられることを確認します。
