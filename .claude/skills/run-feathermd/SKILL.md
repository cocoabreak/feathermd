---
name: run-feathermd
description: Build, launch, and drive the FeatherMD Tauri desktop app (WebView2) via Chrome DevTools Protocol — take screenshots, click elements, dispatch keyboard shortcuts, evaluate JS, open files without the native file dialog. Use when asked to run, start, screenshot, or verify a UI change in this app.
---

# FeatherMD 起動・操作スキル

Tauri v2 + Svelte 5 + SvelteKit製のWindowsデスクトップアプリ（`app/`がフロントエンド、`app/src-tauri/`がRustバックエンド）。WebView2（Chromiumベース）で描画されるため、**Chrome DevTools Protocol (CDP)** で実際のウィンドウを操作できる。ドライバーはNode.js組み込みの`fetch`/`WebSocket`のみを使用し、追加パッケージのインストールは不要。

**このファイルのパスはリポジトリルート（`feathermd/`）基準。** ドライバーは
`.claude/skills/run-feathermd/driver.mjs`。

## 前提

- **本スキルはWindows専用**（WebView2のCDPポート・`taskkill`前提。LinuxのWebKitGTK / macOSのWKWebViewはCDP非対応のため流用不可。CI等での自動E2Eが必要になった場合はtauri-driver等を別途検討する — `.kiro/backlog.md`「E2Eテスト基盤」参照）
- Node.js（組み込み`fetch`/`WebSocket`を使うため v22 以降推奨。確認済み: v22.22.3）
- Rust/cargo（`app/src-tauri`のビルドに必要。確認済み: cargo 1.96.0）
- Windows + WebView2ランタイム（Windows 11は標準搭載）

## 実行（エージェント向け・推奨パス）

すべて**リポジトリルート**から実行する。各コマンドは新規Nodeプロセスとして起動し、都度CDPへ再接続してから終了する（tmux等の常駐REPLは不要）。

```bash
# 1. 起動（--remote-debugging-port=9222を有効化してnpm run tauri devを起動、PIDを記録）
node .claude/skills/run-feathermd/driver.mjs launch
# → "CDP準備完了。" が出るまで待つ（初回Rustビルドがあると数分かかることがある）

# 2. スクリーンショット
node .claude/skills/run-feathermd/driver.mjs screenshot .claude/skills/run-feathermd/screenshots/foo.png

# 3. ネイティブファイルダイアログを介さずファイルを開く（devビルド限定フック、後述）
node .claude/skills/run-feathermd/driver.mjs openFile "E:/path/to/file.md"

# 4. 要素をクリック（CSSセレクタ）
node .claude/skills/run-feathermd/driver.mjs click 'button[aria-label="設定"]'

# 5. キーボードショートカットを送る（document.bodyから bubbles:true でdispatchし、window側の
#    keydownリスナーへ届ける。"Ctrl+W" のように "+" 区切り、最後がkey値）
node .claude/skills/run-feathermd/driver.mjs key "Ctrl+W"

# 6. 任意のJSを評価（Promiseはawaitされ、returnByValueで結果が返る）
node .claude/skills/run-feathermd/driver.mjs eval 'document.title'

# 7. 終了（起動時に記録したPIDのプロセスツリーをtaskkillで終了）
node .claude/skills/run-feathermd/driver.mjs quit
```

スクリーンショットは`.claude/skills/run-feathermd/screenshots/`配下に保存し、Readツールで直接確認する。

### Svelteストアの状態を直接確認する

Vite dev serverはESMをそのまま配信しているため、`eval`から動的importでストアの中身を直接読める（DOM経由の確認だけでは分かりにくい状態変化のデバッグに有効）。

```bash
node .claude/skills/run-feathermd/driver.mjs eval \
  '(async () => { const m = await import("/src/lib/stores/tab.svelte.ts"); return m.tabStore.tabs; })()'
```

## Run (human path)

```bash
cd app
npm run tauri dev
```

実際のウィンドウが開き、`Ctrl+C`で終了。ヘッドレス確認には使えない（このスキルの`launch`を使うこと）。

## Gotchas

- **ネイティブファイルダイアログはCDPで操作できない**（OSのモーダルであり、WebView2のコンテンツ外）。そのため`app/src/routes/+page.svelte`の`onMount`に、`import.meta.env.DEV`限定で`window.__e2e = { openMarkdownFile }`を公開するフックを追加している。本番ビルドではこのブロックごとdead-code-eliminationされる。ファイル/フォルダを開く自動操作はこのフック（`openFile`サブコマンド）を使うこと。
- **既に起動中の同じアプリ（リリースビルド等）があるとCDPが永久にタイムアウトする**。WebView2は既定でアプリ識別子（`com.cocoabreak.feathermd`）ごとに固定のuser-data-dirを使うため、同一識別子の別インスタンスが先に起動しているとプロファイルが排他ロックされ、`driver.mjs launch`したプロセスのWebViewが初期化されずCDPポートも開かない（`feathermd.exe`プロセス自体は起動するが`msedgewebview2.exe`の子プロセスが一切生えない状態になる）。`launch`は`WEBVIEW2_USER_DATA_FOLDER`で`.claude/skills/run-feathermd/.webview2-profile/`という専用ディレクトリを指定することでこれを回避している。もし手動でこの環境変数を外して再現したくなった場合の切り分け: `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'"`でその`feathermd.exe`のPIDを親に持つプロセスが存在するか確認する。
- **`window.dispatchEvent(new KeyboardEvent(...))`はNG**。`e.target`が`window`になり、このアプリの`handleKeydown`内`(e.target as HTMLElement).matches(...)`呼び出しが「`window`に`matches`メソッドがない」というTypeErrorで失敗する。ブラウザの仕様上、リスナー内の例外は`dispatchEvent`の呼び出し元には伝播せず握りつぶされるため、**何も起きていないのにコマンドは正常終了したように見える**。`document.body.dispatchEvent(..., {bubbles:true})`で`window`まで届かせること（`driver.mjs`の`key`コマンドは対応済み）。
- **クリック直後にDOM属性を読んでも反映されていないことがある**。Svelte 5のエフェクト適用は非同期にバッチされるため、`click()`と同じ同期処理内で`aria-label`等を読むと古い値が返ることがある。`await new Promise(r=>setTimeout(r,100~150))`を挟んでから確認する。
- **タブのピン留めボタンのように同一`aria-label`が複数存在するUI**は、`document.querySelectorAll(...)`のインデックスで対象を絞る（例: `[0]`が一番左のタブ）。
- **`quit`は`taskkill /PID <pid> /T /F`でプロセスツリーごと終了**する。`npm run tauri dev`は`cargo`のビルド/実行や`vite`等、子プロセスの連鎖が長い（今回の実測でも十数個のPIDが連鎖）。単体の`kill`では取りこぼすため、必ず`/T`でツリーごと終了すること。
- **`el?.click() ?? "NOT_FOUND"`のような即席のeval式は成否判定として信用できない**。`element.click()`は`undefined`を返すため、要素が見つかってクリックが成功した場合でも`undefined ?? "NOT_FOUND"`は`"NOT_FOUND"`になる（見つからなかった場合と区別が付かない）。`driver.mjs`の`click`コマンドは`if (!el) return "NOT_FOUND"; el.click(); return "OK";`という形に分けて対応済みだが、`eval`サブコマンドで独自にクリック式を書くときは同じ罠に注意する。

## Troubleshooting

| 症状 | 原因・対処 |
|---|---|
| `driver.mjs launch`がCDP待ちでタイムアウトする | 原因1: 初回Rustビルドに数分かかることがある（タイムアウトは180秒、足りなければ`driver.mjs`内の`waitForCdp(180_000)`を伸ばす）。原因2: 同じアプリの別インスタンスが既に起動中でWebView2プロファイルが競合している（Gotchas参照。`launch`は専用プロファイルを使うため通常は自然発生しないが、`driver.mjs`を変更して`WEBVIEW2_USER_DATA_FOLDER`を外した場合に再現する） |
| `openFile`が`"NO_HOOK"`を返す | devモード（`npm run tauri dev`経由）で起動していない、または`+page.svelte`の`__e2e`フックが削除・変更された |
| `openFile`が`ファイルを開けませんでした`で失敗する | 存在しないパスを渡している。バックスラッシュ・スラッシュどちらでも動くが、実在するファイルであることを確認する |
| `Ctrl+W`等のキー送信をしても何も起きない | `document.body`起点でdispatchしているか確認（Gotchas参照）。それでも起きない場合は`eval`で対象のkeydownリスナーが本当に登録されているか確認する |
| `quit`が`"PID xxx が見つかりませんでした"`で失敗する／CDPが応答し続ける | `.driver-pid`のPIDが指すプロセスツリーが（別の`launch`との混在や中間プロセスの異常終了で）既に切れ、`feathermd.exe`本体が孤児化している可能性がある。`Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'"`で`--user-data-dir`が`.claude/skills/run-feathermd/.webview2-profile`（自分専用プロファイル）を指しているものを探し、その最上位（`--type=`が付かない、`feathermd.exe`を親に持つ）プロセスIDに対して`taskkill /PID <id> /T /F`を実行する。`--user-data-dir`が`com.cocoabreak.feathermd\EBWebView`（既定パス）のものは別プロセス（手動起動や他ツールからの起動）の可能性があるため触らないこと。 |
