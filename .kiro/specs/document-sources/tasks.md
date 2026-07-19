# 実装タスク: 読み取り専用ドキュメントソース (document-sources)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

## T-001: 契約とテスト基盤

- [x] RustにVirtualPath検証、DocumentRef、SourceCapabilitiesを定義する
- [-] 構造化SourceErrorを定義する（v0.1.0は既存Tauri契約の文字列エラーを維持）
- [x] フロントにDocumentRef、DocumentSourceInfo、SourceSpecと安定キー関数を定義する
- [x] VirtualPathの正常化・ルート脱出・NUL・絶対パスの境界値テストを追加する
- [x] SourceRegistryの登録・取得・解除・未知ID拒否テストを追加する

## T-002: NativeSource移行

- [x] 既存AllowedRoots・readers・search・wikiをNativeSourceから利用できるようにする
- [x] list/readMarkdown/readImage/search/wikiを共通source commandへ接続する
- [x] Explorer、タブ、ViewerをDocumentRefへ移行する
- [x] 相対リンク・画像・全文検索・WikiリンクをsourceId経由へ移行する
- [x] Native watcherイベントをDocumentRefへ変換する
- [x] 外部エディターをcapability判定と検証済み実パス経由にする
- [x] Nativeの既存テストと実アプリ主要動作が変わらないことを確認する

## T-003: ZipSourceコア

- [x] `zip`クレートのバージョン・features・ライセンス・依存監査を確定する
- [x] 明示選択したZIPを検証してSourceRegistryへ登録する
- [x] ZIPインデックス構築と暗黙ディレクトリ合成を実装する
- [x] ZIP内list/readMarkdown/readImage/resolveを実装する
- [x] 暗号化・分割・未対応圧縮・symlink・不正パス・重複パスを拒否する
- [x] エントリ数・サイズ・総量・圧縮率・実読込量制限を実装する
- [x] 正常ZIP、日本語名、空ZIP、破損ZIP、ZIP64、悪性入力のRustテストを追加する

## T-004: ZIP UI統合

- [x] アーカイブ選択dialog/menu/actionを追加する
- [x] ZIPはファイル単体で認可し、確認画面へアーカイブのフルパスを表示する
- [x] ZIPをExplorerルートとして表示し、内部フォルダーを遅延展開する
- [x] ZIP内Markdownをタブで表示する
- [x] ZIP内相対リンク・アンカー・画像を表示する
- [x] ZIPではexternalEditorとrespectGitignoreを無効化する
- [x] ZIP用の表示パス・エラー文言・i18nを追加する

## T-005: 検索・Wiki・永続化・監視

- [x] ZIP全文検索を既存上限・キャンセル・latest-only制御へ統合する
- [x] ZIP Wikiリンク索引とsource generationによる無効化を実装する
- [x] ZIPを最近使った項目へ保存・再オープンできるようにする
- [x] SourceSpecとZIP内タブのセッション保存・復元を実装する
- [x] ZIPコンテナwatcher、再インデックス、Explorer/タブ更新を実装する
- [x] 更新で消えたエントリをdeleted状態にする

## T-006: 検証

- [x] format / lint / svelte-check / frontend test / buildを通す
- [x] cargo fmt / clippy / testを通す
- [x] npm audit / cargo auditで新規依存を確認する
- [x] NativeSourceのフォルダー・リンク・画像・検索・Wiki・監視・復元を実アプリ確認する
- [x] ZipSourceの一覧・Markdown・画像・リンク・検索・Wiki・監視・復元を実アプリ確認する
- [x] 大規模・高圧縮率・破損ZIPを自動テストし、正常ZIPの応答性とエラー表示を実アプリ確認する
- [x] 設計・差分レビューとセキュリティレビューを実施する
