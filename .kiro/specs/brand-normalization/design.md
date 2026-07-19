# 技術設計: FeatherMDブランド統一 (brand-normalization)

## ステータス

完了

## 1. 公開URL

- READMEのReleases／clone URLとAboutのGitHubリンクを`cocoabreak/feathermd`へ変更する
- 過去の内部Issue番号は新公開リポジトリへ引き継がないため、該当課題をbacklogへ移管する
- GitHub Actionsは`GITHUB_REPOSITORY`等の実行時コンテキストを利用しており、リポジトリslugを追加で固定しない

## 2. メタデータ

- npmパッケージ名を`feathermd`とし、description、repository、homepage、bugsを設定する
- Cargo packageは既存の`feathermd`を維持し、description、repository、homepageを公開情報へ揃える
- Tauriの`productName = FeatherMD`、`identifier = com.cocoabreak.feathermd`を正とする
- 所有ドメイン`cocoabreak.com`を逆引き形式で名前空間に用い、公開前に識別子を確定する

## 3. 開発用名称

- Serenaのproject nameとリポジトリ構造例を`feathermd`へ変更する
- Codex／Claudeの実アプリ操作スキルを`run-feathermd`へ改名し、記載するTauri identifierも現行値へ修正する
- レビュースキル内の対象製品名をFeatherMDへ変更する

## 4. 改名しないもの

- `MarkdownViewer.svelte`等の内部シンボルは役割を表すため維持する
- 「Markdown viewer」「Markdownビューワー」は製品カテゴリの説明として必要な箇所では維持する
- 現在のローカル作業ディレクトリ名、Git remote、コミット履歴は本specで変更しない

## 5. v0.1.0のWindows配布

- v0.1.0のGitHub Releases配布物はコード署名しない
- 英語・日本語READMEでSmartScreen警告の可能性、公式Releasesページからの取得、実行前の入手元確認を案内する
- コード署名の導入は公開後にSignPath Foundation等を候補として別途検討する
