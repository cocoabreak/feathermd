# 要求定義: WebView2自動スモークテスト (webview2-smoke-tests)

## 背景・動機

FeatherMDにはVitestとRustユニットテストがある一方、Tauri・WebView2・フロントエンド・Rustコマンドを結合した実アプリの確認は `run-feathermd` スキルによる対話操作に依存している。Markdown表示、Mermaid、ZIP、大容量文書、更新通知、セッション復元の主要経路を対話可能なローカルWindowsで継続検証し、単体テストでは検出できない統合回帰をリリース前に検出する。GitHub hosted Windows runnerでは本番フロントエンドとTauriアプリのビルド可能性を検証する。

## スコープ

- **対象**: Windows WebView2上のdevビルド、CDPによる起動・DOM操作・状態確認、決定的fixture、ローカル実行時の失敗artifact、GitHub hosted Windows runnerでの本番フロントエンド・Tauriビルド
- **対象外**: MSI/NSIS/portable配布物、インストール・アンインストール、実GitHub Releases API、Linux WebKitGTK、macOS WKWebView、ネイティブファイルダイアログ自体の自動操作
- 既存 `run-feathermd` は対話確認用として維持し、自動スモークテストと低レベルCDP処理だけを共有する

---

## ユーザーストーリー

### US-001: 一コマンドでのローカル実行

As a 開発者
I want to WebView2スモークテストを一コマンドで実行できる
So that 主要な実アプリ回帰をコミット前に確認できる

**受け入れ条件**

- [x] Windowsで `npm run e2e:smoke` を実行するとTauri devアプリが専用WebViewプロファイルで起動する
- [x] テスト終了時は成功・失敗にかかわらずアプリのプロセスツリーと一時fixtureを後始末する
- [x] 各シナリオの成功・失敗がテスト名とともに標準出力へ表示され、1件でも失敗すれば非0で終了する
- [x] 既存の対話用 `run-feathermd` 操作は従来どおり利用できる

### US-002: 主要レンダリング経路の検証

As a 開発者
I want to Markdown・Mermaid・ZIPの実表示を自動確認したい
So that WebView上で初めて発生するレンダリング回帰を検出できる

**受け入れ条件**

- [x] 通常Markdownを開き、タブと本文が表示される
- [x] 正常なMermaidコードがSVGへ変換される
- [x] 不正なMermaidコードがエラーUIとなり、アプリ全体は操作可能なままである
- [x] 実行時生成したZIPをExplorerへ開き、ZIP内Markdownを表示できる

### US-003: 大容量境界の検証

As a 開発者
I want to 5MiB境界の大容量文書表示を自動確認したい
So that セーフモードへの遷移回帰を検出できる

**受け入れ条件**

- [x] 5MiB未満のfixtureは通常レンダリングされる
- [x] 5MiB以上のfixtureは、dev限定フックから確認結果を注入するとセーフモードで表示される
- [x] dev限定フックはproductionビルドで利用できない
- [x] 巨大fixtureはリポジトリへ格納せず実行時に生成する

### US-004: 更新通知とセッション復元の検証

As a 開発者
I want to 更新通知とリロード復元を決定的に確認したい
So that 外部ネットワークに依存せず状態連携の回帰を検出できる

**受け入れ条件**

- [x] dev限定フックで更新あり結果を注入すると更新通知が表示される
- [x] 実GitHub APIへ通信しない
- [x] タブ・検索条件・スクロール位置を保存後にWebViewをリロードすると、確認なしで同じ状態が復元される

### US-005: WindowsビルドCIゲート

As a メンテナー
I want to pull requestごとにWindowsデスクトップアプリのビルドを検証したい
So that mainへ統合する前に本番フロントエンドやTauriアプリのビルド回帰を検出できる

**受け入れ条件**

- [x] `windows-latest` の独立ジョブで本番フロントエンドとTauriアプリをビルドする
- [x] npm依存とRustビルドをキャッシュする
- [x] production成果物にdev限定E2Eフックが含まれないことを検査する
- [x] WebView2スモークテストは対話可能なローカルWindowsでリリース前に完走する
- [x] GitHub hosted runner上のbuild成功を、WebView2実画面テスト成功として扱わない
- [x] タイムアウトで無期限にrunnerを占有しない

## 非機能要求

- Playwright、tauri-driver等の新規依存を追加せずNode.js組み込みAPIとCDPを使う
- CDPポート、WebViewプロファイル、一時fixtureはテスト実行単位で分離する
- 待機は固定sleepだけに依存せず、期限付き条件ポーリングを使う
- dev限定フックは `import.meta.env.DEV` とRustの `debug_assertions` 境界を維持する

## 未決定事項（設計フェーズで決定）

- [x] Playwright / tauri-driver / 既存CDPのどれを使うか
- [x] CI対象OSとビルド種別
- [x] ネイティブダイアログ・外部ネットワーク依存をどう決定的にするか
- [x] fixtureと失敗成果物の保存場所
