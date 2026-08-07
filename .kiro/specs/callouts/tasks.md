# 実装タスク: Callouts (callouts)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

## T-001: Callout token変換

- [x] 対応種別、別名、既定タイトル、上限を定義する
- [x] blockquote tokenをCalloutへ変換するmarkdown-it core ruleを実装する
- [x] 通常`aside`と折りたたみ`details`のrenderer ruleを実装する
- [x] タイトルのインラインMarkdownと固定SVGアイコンを実装する
- [x] 未知種別・不正記法・上限超過を通常引用へフォールバックする

## T-002: 既存プラグイン統合と依存整理

- [x] `markdown-dialects`へCallout ruleを登録する
- [x] `markdown-it-github-alerts`を依存とコードから削除する
- [x] 脚注、定義リスト、通常blockquoteの既存動作を維持する

## T-003: スタイル・テーマ・出力

- [x] Callout基本スタイルと種別色を追加する
- [x] 折りたたみ・入れ子・ライト／ダークテーマを調整する
- [x] 印刷時に閉じたCallout本文を表示する
- [x] HTML出力とカスタムCSSの既存経路で構造・styleを維持する

## T-004: 自動テスト

- [x] 対応種別、別名、タイトル、折りたたみのテストを追加する
- [x] 内部Markdown、Wikiリンク、画像、コードブロック、入れ子のテストを追加する
- [x] sanitizeと固定SVGのセキュリティテストを追加する
- [x] 深度・個数・タイトル長の境界テストを追加する
- [x] style、印刷、既存Markdown方言の回帰テストを追加する

## T-005: 検証用Markdownと実アプリ確認

- [x] 網羅的な一時検証用Markdownを作成する
- [x] 折りたたみ、テーマ、入れ子、内部Markdown、通常引用を実アプリで確認する
- [x] 印刷／HTML出力とカスタムCSSの共存を確認する
- [x] 代表ケースを`samples/markdown-compatibility.md`へ統合する
- [x] 網羅用の一時ファイルをコミット対象から除外する（ユーザー確認まではuntrackedで保持）

## T-006: 検証・レビュー

- [x] frontend format / lint / check / testを完了する
- [x] Rust fmt / Clippy / testを完了する
- [x] 設計・差分レビューを完了する
- [x] セキュリティレビューを完了する
- [x] 未解決P0/P1/P2がないことを確認する
