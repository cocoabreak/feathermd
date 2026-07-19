# 要求定義: FeatherMDブランド統一 (brand-normalization)

## 背景・動機

v0.1.0をFeatherMDの最初の公開版として新しい公開リポジトリから配布するため、ソース内に残る旧リポジトリ名、固定URL、開発用識別子を正式名称へ統一する。

## スコープ

- **対象**: 公開URL、README、アプリ／パッケージメタデータ、About、steering、spec、backlog、開発用スキル、Serena設定
- **対象外**: Git remoteの変更、新公開リポジトリへのpush、公開用Git履歴の作成、設定画面再構成、リリース文書作成
- **維持する名称**: `MarkdownViewer.svelte`など役割を表す内部シンボルと、製品カテゴリとしての一般名詞「Markdown viewer」

## 受け入れ条件

- [x] 公開先を示す固定URLが`https://github.com/cocoabreak/feathermd`へ統一される
- [x] アプリ、npm、Cargo、Tauriの製品名と識別子がFeatherMD／feathermdへ統一される
- [x] 英語・日本語READMEの取得・ビルド手順が新公開リポジトリを参照する
- [x] steering、spec、backlog、開発用スキルに旧プロジェクト固有名が残らない
- [x] 旧内部リポジトリのIssueリンクを公開成果物へ持ち込まない
- [x] 一般名詞と内部実装シンボルを過剰に改名しない
- [x] v0.1.0のWindowsバイナリをコード署名なしで配布することとSmartScreen警告への注意を英語・日本語READMEへ明記する

## 未決定事項（設計フェーズで決定）

- [x] 公開リポジトリURL: `https://github.com/cocoabreak/feathermd`
- [x] 開発用実アプリ操作スキル名: `run-feathermd`
- [x] Tauriアプリ識別子: `com.cocoabreak.feathermd`
- [x] v0.1.0のWindows配布: バイナリはコード署名なしとし、READMEで安全な入手元と警告を案内する
- [x] Git履歴とremoteの切り替え: 最終QA後の公開工程で別途実施する
