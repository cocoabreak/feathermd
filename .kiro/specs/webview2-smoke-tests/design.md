# 技術設計: WebView2自動スモークテスト (webview2-smoke-tests)

## ステータス

完了

## 1. 基盤選定

既存 `run-feathermd` で実績のあるWebView2 CDP接続を採用する。Node.js組み込みの `fetch` / `WebSocket` / `child_process` だけで動作し、ブラウザーバイナリやWebDriverの追加導入が不要である。

- `app/scripts/webview2-driver.mjs`: 起動、CDP接続、評価、スクリーンショット、条件待機、プロセス終了の共通処理
- `.agents/skills/run-feathermd/driver.mjs`: 共通処理を利用する対話用CLI
- `app/e2e/smoke.mjs`: fixture生成とシナリオ実行を担う自動テストrunner

## 2. 起動・分離・後始末

runnerは空きTCPポートをOSから取得し、`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`を設定する。WebViewプロファイル、アプリ状態、fixtureは `os.tmpdir()` 配下の実行専用ディレクトリへ置く。アプリ状態には起動時更新確認OFFを事前設定し、実GitHub APIへの通信を防ぐ。debugビルド限定の `FEATHERMD_E2E_DISABLE_SINGLE_INSTANCE=1` で既存の手動起動プロセスと競合しないようにする（releaseでは環境変数を無視する）。

Tauri devの標準出力・標準エラーは `app/e2e/artifacts/tauri.log` へ保存する。runner全体を `try/finally` で囲み、Windowsでは `taskkill /PID <pid> /T /F` でプロセスツリーを停止し、一時ディレクトリを再試行付きで削除する。失敗時は終了前に `failure.png` を保存する。

## 3. fixture

実行時に以下を生成する。

- 通常Markdown
- 正常・異常Mermaid
- 5MiB直前 / 5MiB到達のMarkdown
- ルート直下にMarkdownを含むstore方式の最小ZIP

ZIPはテストrunner内の小さなCRC32/ZIP writerで生成し、PowerShellや外部パッケージへ依存しない。

## 4. dev限定E2Eフック

`+page.svelte` の `import.meta.env.DEV` ブロックから `window.__e2e` を公開する。productionではブロック全体がdead-code eliminationされる。

- `openMarkdownFile(path)`
- `openLargeMarkdownInSafeMode(path)`: 本来と同じ大容量判定へ承認済みの確認関数を注入
- `openArchive(path)` / `openArchiveEntry(documentPath)`
- `showUpdateAvailable()`: `updateCheckStore`へ制御済み結果を反映
- `flushSession()`: 最新セッションを保存・flush

Rustのパス認可は既存 `authorize_dev_path` を利用し、`debug_assertions` 以外では拒否する。フックは信頼境界をproductionで拡張しない。

## 5. シナリオ

各シナリオは期限付き `waitFor` でDOMまたはストア状態を待つ。

1. 起動と通常Markdown
2. Mermaid正常SVG
3. MermaidエラーUI
4. ZIP内Markdown
5. 5MiB未満の通常表示と5MiB到達時のセーフモード
6. 更新通知
7. DOM描画とスクロール状態反映を待ち、実際の `Ctrl+R` ハンドラーで保存・再読込する。旧ページへ置いたマーカーが消えて新しいWebView文脈へ移ったことを確認した後、検索・スクロール復元を検証する

外部GitHub API、ネイティブダイアログ、インストーラーはこのsuiteでは呼ばない。

## 6. CIとリリースゲート

GitHub hosted Windows runnerではTauriプロセスを起動できても、対話デスクトップを必要とするWebView2がCDPポートを公開しないため、実画面スモークの実行環境として扱わない。`.github/workflows/ci.yml` のWindows専用 `windows-desktop-build` ジョブは、本番フロントエンドとTauriアプリのビルド可能性を検証する。

- Node.js 24、Rust stable、npm/Rust cache
- `npm ci`
- `npm run build && npm run e2e:check-production`
- `cargo build --locked --no-default-features`
- `timeout-minutes: 20`

`npm run e2e:smoke` は対話可能なローカルWindowsでリリース前に必ず完走する。将来CIへ完全自動化する場合は、対話セッションとWebView2 Runtimeを管理できるWindows self-hosted runnerを使用する。

## 7. エラー処理

- CDP起動・DOM待機・評価には個別の期限を設ける
- `Runtime.exceptionThrown` とブラウザーconsole errorを収集し、想定済みMermaid構文エラー以外を失敗へ含める
- fixtureパスや一時プロファイルはログへ出してよいが、リポジトリ内ドキュメントへ実在ローカル絶対パスを記録しない
