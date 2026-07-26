# 実装タスク: ローカルリンク先のホバープレビュー

## 前提

- [x] 0.1 `link-inspector` specの共通リンク解決契約が利用可能であることを確認する

## 1. 制限付きプレビュー読込

- [ ] 1.1 `LinkPreviewReadResponse`の`Ready | Missing`と256KiB上限を追加する
- [ ] 1.2 NativeSourceでAllowedRoots・最終ファイルハンドル検証付き読込を実装する
- [ ] 1.3 ZipSourceでentry・圧縮率・実展開量検証付き読込を実装する
- [ ] 1.4 UTF-8境界を安全に切り詰める
- [ ] 1.5 currentとtargetのSource ID一致をRust側で検証する
- [ ] 1.6 `read_source_link_preview`コマンドを登録する
- [ ] 1.7 Native/ZIP、上限境界、危険entry、非Markdown、別Source拒否のRustテストを追加する
- [ ] 1.8 Missingと検証エラーを文字列解析なしで分離する境界テストを追加する

## 2. プレビュー抽出

- [ ] 2.1 既存`extractFrontmatter`を使い`title`、`aliases`、`tags`を型検証する
- [ ] 2.2 title／各要素256文字、各配列32件、メタデータ総量8KiBの上限を実装する
- [ ] 2.3 見出しまたは文書冒頭からプレーンテキスト抜粋を生成する
- [ ] 2.4 コード、HTML、画像、Markdown記号を除外する
- [ ] 2.5 320文字上限とプレビュー範囲外状態を実装する
- [ ] 2.6 frontmatter、見出し、切り詰め、危険HTMLの単体テストを追加する
- [ ] 2.7 巨大title、数万件のaliases／tags、巨大要素、型不一致の負荷テストを追加する

## 3. StoreとDOMイベント

- [ ] 3.1 `LinkPreviewStore`へ状態、request ID、タイマー、最大32件LRUを実装する
- [ ] 3.2 generation・watcher・文書削除時のキャッシュ無効化を実装する
- [ ] 3.3 `setupLinkPreviewTrigger`をイベント委譲とcleanup付きで実装する
- [ ] 3.4 Wikiリンクの`pending | resolved | missing`と購読通知をWeakMapレジストリへ実装する
- [ ] 3.5 Markdownリンクを共通契約で同一Source内DocumentRefへ解決する
- [ ] 3.6 450ms表示、150ms非表示、latest-only、リンク切れのテストを追加する
- [ ] 3.7 偽造class・data属性・別Source IDから読込できない境界テストを追加する
- [ ] 3.8 hover／focus中のpendingからresolved／missingへの遷移とcleanup競合をテストする

## 4. ポップオーバー

- [ ] 4.1 `LinkPreviewPopover.svelte`を1インスタンスで実装する
- [ ] 4.2 タイトル、相対パス、見出し、抜粋、aliases、tags、状態表示を実装する
- [ ] 4.3 下／上反転、左右クランプ、scroll／resize追従を実装する
- [ ] 4.4 pointer、focus、`Escape`、フォーカス維持、tooltip関連付けを実装する
- [ ] 4.5 元リンクのクリック・Enter遷移に回帰がないことをテストする
- [ ] 4.6 WebView2でWiki／Markdown、見出し、リンク切れ、キーボード操作を確認する

## 5. 完了検査

- [ ] 5.1 `npm run format`、`npm run lint`、`npm run check`、`npm test`を実行する
- [ ] 5.2 `cargo fmt`、`cargo clippy -- -D warnings`、Rustテストを実行する
- [ ] 5.3 Windows WebView2スモークテストを実行する
- [ ] 5.4 設計・差分レビューを実施し、P0〜P2を解消する
- [ ] 5.5 ファイル・パス・HTML表示を対象とするセキュリティレビューを実施し、P0〜P2を解消する
