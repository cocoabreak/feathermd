# 実装タスク: Wikiリンク

## 1. Rust（リンク解決）

- [x] 1.1 `commands/wiki.rs`: `resolve_wiki_links` コマンドを実装する（AllowedRoots検証・再帰走査・マッチング・近接優先ランキング）
- [x] 1.2 `lib.rs` / `commands/mod.rs`: モジュール・コマンドを登録する
- [x] 1.3 マッチング・ランキング・gitignore考慮のユニットテストを追加する

## 2. プラグイン機構の拡張

- [x] 2.1 `plugins/types.ts`: `PostRenderContext` を定義し `postRender` の第2引数にする
- [x] 2.2 `MarkdownViewer.svelte`: postRender呼び出しにコンテキストを渡す（`untrack` で依存を絞る）
- [x] 2.3 `plugins/README.md`: postRenderのシグネチャ変更を反映する

## 3. wiki-linksプラグイン

- [x] 3.1 `plugins/wiki-links/index.ts`: markdown-it inlineルール（基本・エイリアス・アンカー・同一ファイルアンカー）を実装する
- [x] 3.2 postRender: バッチ解決・href書き込み・未解決グレーアウト・スタイル注入を実装する
- [x] 3.3 パースのユニットテスト（エイリアス・アンカー・不成立ケース・コード内非パース）を追加する

## 4. 検証

- [x] 4.1 `npm run format` / `lint` / `check` / `test`、`cargo fmt` / `clippy` / `test` を通す
- [x] 4.2 実機（CDP）で遷移・アンカージャンプ・未解決グレーアウト・設定トグル・同名優先順位を確認する
