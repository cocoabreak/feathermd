# 技術設計: Wikiリンクのバックリンク

## ステータス

完了

## 1. Rust側索引

`sources.rs`へ`list_source_backlinks`を追加し、`spawn_blocking`内でSourceRegistryから対象Sourceを取得する。候補列挙は既存`collect_source_markdown_paths`、本文取得は`read_source_text`を再利用し、NativeSourceではAllowedRootsによる候補ごとの再検証、ZipSourceでは登録済み中央ディレクトリと同一アーカイブハンドルを使う。

戻り値は`BacklinkResponse { results, truncated }`とし、結果は`BacklinkResult { document, filePath, referenceCount }`をパス順で返す。生の本文や絶対パスは新たに返さない。

## 2. Wikiリンク抽出と解決

`pulldown-cmark`のオフセット情報でインラインコード、コードブロック、HTMLの範囲を除外したうえで、生のMarkdownから既存構文と同じ`[[target#hash|alias]]`を抽出する。同一ファイルアンカー`[[#heading]]`はバックリンク対象にしない。

既存の候補全走査型解決を、ファイル名から候補を絞る`WikiFileIndex`へ内部的に置き換える。パス付きターゲットも最終ファイル名で候補を絞ってからコンポーネント境界の末尾一致と既存の近接優先ランキングを適用する。前方Wikiリンクとバックリンクは同じ解決関数を使い、結果の不一致を防ぐ。

## 3. 負荷制御とキャッシュ

- 文書候補: 既存上限10,000件
- 1文書: 既存上限10MiB
- 1索引の展開後総読込量: 100MiB
- ZIP圧縮データ総量: 100MiB
- 抽出するWikiリンク: 100,000件
- 1リンクのターゲット名: 1,024バイト
- 候補解決検査: 1,000,000件
- キャッシュ: 最大4索引、TTL 30秒

キャッシュキーはSource ID、generation、`showHiddenFiles`、`respectGitignore`。`forceRefresh`で対象キーを再構築する。索引構築はRust側で全体1件に制限し、WebViewからの並行要求による走査の多重化を防ぐ。NativeSourceの未監視ファイル変更を完全には捕捉できないためTTLと手動更新を併用し、`file-changed` / `file-deleted` / `directory-changed`を受信した場合はフロント側で対象Sourceをdirtyとして次回ロードを強制更新する。ZipSourceはgeneration変更で自然に別キーとなる。

## 4. フロントエンド

`BacklinksStore`は現在のDocumentRef・DocumentSourceInfoと設定からscopeを作り、リクエスト番号で古い応答を破棄する。連続する再構築要求は最新要求へまとめて直列実行する。`BacklinksPanel.svelte`はマウント時にだけ`load()`し、再読み込み、空状態、エラー、省略表示を担当する。結果クリックは`openSourceMarkdown`へ委譲する。

`uiStore.sidebarActiveTab`へ`backlinks`を追加し、`Sidebar.svelte`のヘッダーへ`Link2`アイコンの3番目のタブを追加する。Explorer/Searchの既存責務や右側TOCパネルは変更しない。Wikiリンクプラグインが無効、現在文書なし、Source capabilityなしの場合は理由を表示してRustコマンドを呼ばない。

## 5. 安全性

- WebViewから渡すSource IDとDocumentRefはRust側SourceRegistryで再検証する
- NativeSource本文は開いたファイルハンドルの最終パスをAllowedRootsで確認する既存経路を再利用する
- ZipSourceは既存のエントリ同一性・展開サイズ・圧縮率検証済み索引だけを読む
- 結果クリックは既存のサイズ確認・タブ・watcher経路を通す
- 上限到達時は部分結果と`truncated`を返し、上限を拡張しない
