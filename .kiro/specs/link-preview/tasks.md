# 実装タスク: ローカルリンク先のホバープレビュー

## 前提

- [x] 0.1 `link-inspector` specの共通リンク解決契約が利用可能であることを確認する

## 1. 制限付きプレビュー読込

- [x] 1.1 `LinkPreviewReadResponse`の`Ready | Missing`と256KiB上限を追加する
- [x] 1.2 NativeSourceでAllowedRoots・最終ファイルハンドル検証付き読込を実装する
- [x] 1.3 ZipSourceでentry・圧縮率・実展開量検証付き読込を実装する
- [x] 1.4 UTF-8境界を安全に切り詰める
- [x] 1.5 currentとtargetのSource ID一致をRust側で検証する
- [x] 1.6 `read_source_link_preview`コマンドを登録する
- [x] 1.7 Native/ZIP、上限境界、危険entry、非Markdown、別Source拒否のRustテストを追加する
- [x] 1.8 Missingと検証エラーを文字列解析なしで分離する境界テストを追加する

## 2. プレビュー抽出

- [x] 2.1 既存`extractFrontmatter`を使い`title`、`aliases`、`tags`を型検証する
- [x] 2.2 title／各要素256文字、各配列32件、メタデータ総量8KiBの上限を実装する
- [x] 2.3 見出しまたは文書冒頭からプレーンテキスト抜粋を生成する
- [x] 2.4 コード、HTML、画像、Markdown記号を除外する
- [x] 2.5 320文字上限とプレビュー範囲外状態を実装する
- [x] 2.6 frontmatter、見出し、切り詰め、危険HTMLの単体テストを追加する
- [x] 2.7 巨大title、数万件のaliases／tags、巨大要素、型不一致の負荷テストを追加する

## 3. StoreとDOMイベント

- [x] 3.1 `LinkPreviewStore`へ状態、request ID、タイマー、最大32件LRUを実装する
- [x] 3.2 generation・watcher・文書削除時のキャッシュ無効化を実装する
- [x] 3.3 `setupLinkPreviewTrigger`をイベント委譲とcleanup付きで実装する
- [x] 3.4 Wikiリンクの`pending | resolved | missing`と購読通知をWeakMapレジストリへ実装する
- [x] 3.5 Markdownリンクを共通契約で同一Source内DocumentRefへ解決する
- [x] 3.6 450ms表示、150ms非表示、latest-only、リンク切れのテストを追加する
- [x] 3.7 偽造class・data属性・別Source IDから読込できない境界テストを追加する
- [x] 3.8 hover／focus中のpendingからresolved／missingへの遷移とcleanup競合をテストする

## 4. ポップオーバー

- [x] 4.1 `LinkPreviewPopover.svelte`を1インスタンスで実装する
- [x] 4.2 タイトル、相対パス、見出し、抜粋、aliases、tags、状態表示を実装する
- [x] 4.3 下／上反転、左右クランプ、scroll／resize追従を実装する
- [x] 4.4 pointer、focus、`Escape`、フォーカス維持、tooltip関連付けを実装する
- [x] 4.5 元リンクのクリック・Enter遷移に回帰がないことをテストする
- [x] 4.6 WebView2でWiki／Markdown、見出し、リンク切れ、キーボード操作を確認する

## 5. リンクグラフ統合

- [x] 5.1 Cytoscapeノードのhoverと描画境界を共通Storeへ渡すアダプターを実装する
- [x] 5.2 グラフのキーボード選択をプレビュー表示へ接続する
- [x] 5.3 現在文書・解決済み・リンク切れノードの状態を実装する
- [x] 5.4 グラフ別WebViewへ専用StoreとPopoverを1インスタンス配置する
- [x] 5.5 コンテキスト更新・ノード削除・終了時のcleanup競合をテストする
- [x] 5.6 DocumentRefをCytoscape data／DOM属性から復元しない境界テストを追加する

## 6. 完了検査

- [x] 6.1 `npm run format`、`npm run lint`、`npm run check`、`npm test`を実行する
- [x] 6.2 `cargo fmt`、`cargo clippy -- -D warnings`、Rustテストを実行する
- [x] 6.3 Windows WebView2スモークテストを実行する
- [x] 6.4 設計・差分レビューを実施し、P0〜P2を解消する
- [x] 6.5 ファイル・パス・HTML表示を対象とするセキュリティレビューを実施し、P0〜P2を解消する
