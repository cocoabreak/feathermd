# FeatherMD

<p align="center">
  <img src="app/src-tauri/icons/icon-source.png" alt="FeatherMDロゴ" width="180">
</p>

[English](README.md)

FeatherMDは、ローカルMarkdownファイルとZIPアーカイブ内のMarkdownを対象にした高速な読み取り専用ビューワーです。Tauri v2・RustバックエンドとSvelte 5のUIを組み合わせ、編集機能を持たせず、Markdownの快適な閲覧に集中しています。

> 現在はWindowsを最優先で対応しています。LinuxはNice to have、macOSは優先度を低く設定しています。

## 主な機能

- **リッチなMarkdown表示** — 一般的なMarkdown構文、GitHub風テーブル・タスクリスト、Shikiのシンタックスハイライト、KaTeX数式、Mermaid図、絵文字、YAML frontmatterに対応。
- **ネイティブファイルとZIPアーカイブ** — `.md`・`.markdown`を直接開くほか、ZIPを展開せずに内部のMarkdownを探索・表示できます。
- **エクスプローラーとタブ** — フォルダーを探索起点として開き、Markdownファイルを遅延読み込み。複数タブ、並べ替え、ピン留め、閉じたタブの復元、ファイル変更の自動反映に対応。
- **ナビゲーション** — 見出しから生成する目次、バックリンク付きWikiリンク（`[[ページ名]]`）、ローカルMarkdownリンク、戻る／進む履歴、見出しアンカー、タブごとのスクロール位置保持。
- **検索とクイックアクセス** — 表示中ページとエクスプローラー配下の検索、ファイル名からのクイックオープン、コマンドパレットからの操作に対応。
- **画像・図の閲覧** — 信頼済みルート配下のローカル画像を安全に解決し、画像やMermaid図をズーム・パン対応のライトボックスで表示。
- **デスクトップ操作** — ネイティブダイアログ、ドラッグ＆ドロップ、最近使った履歴、キーボードショートカット、コマンドライン、任意で登録するWindows Explorerのコンテキストメニューから開けます。
- **セッション継続** — タブ、ピン留め、アクティブタブ、表示モード、スクロール位置、ページ内検索、Explorer状態、最後のルートを復元。再起動をまたいで信頼するのは最後に明示承認したExplorerルート1件だけです。
- **カスタマイズ** — ライト・ダーク・システムテーマ、本文ズーム、エクスプローラー・目次のリサイズ、レンダラー切替、コードテーマ、行番号、スコープを限定したカスタムCSS。
- **便利機能** — レンダリング／ソース表示切替、コードコピー、文字数・推定読了時間、外部エディター連携、印刷／PDF、HTML出力、図のSVG・PNG出力。
- **日本語・英語UI** — アプリ内UIとネイティブアプリメニューを日本語・英語で表示。

## セキュリティモデル

FeatherMDは、Markdownを信頼できない入力として扱います。以下の保証はreleaseビルドを対象としています。

- ファイルアクセスはRust側でcanonicalizeし、許可済みルート配下か検証します。
- ドライブ直下、Windowsのシステムフォルダー、ユーザープロファイル直下を広い信頼ルートにはできません。
- WebViewから確認なしに信頼フォルダーを追加することはできません。新しいフォルダーにはOS由来の操作またはネイティブ確認が必要です。
- 永続信頼するのは最後に承認したExplorerルート1件だけです。それ以外の最近使ったフォルダーは再確認されます。
- HTMLはサニタイズされ、Mermaidはstrict設定、アプリ全体には制限的なContent Security Policyを適用しています。
- Markdown、画像、カスタムCSS、検索、ディレクトリ走査には、必要に応じて形式・サイズ・件数上限を設けています。
- 起動時には既定でGitHub Releasesへ接続し、新しいバージョンを確認します。設定から無効化でき、更新確認で文書内容やローカルファイルパスを送信することはありません。
- 外部HTTPS画像は選択したプライバシー設定に従います。既定では、現在の文書について利用者が許可するまで画像を取得しません。

この仕組みは悪意ある文書がアクセスできる範囲を制限しますが、信頼できないファイル自体を無害にするものではありません。予期しないアクセス確認が表示された場合は、承認前に対象フォルダーを確認してください。

> 開発ビルドには、CDPを使ったUIテスト向けのdebug専用認可フックがあります。`npm run tauri dev`で信頼できない文書を閲覧せず、その用途にはreleaseビルドを使用してください。

## 主なショートカット

| 操作                       | ショートカット                |
| -------------------------- | ----------------------------- |
| ファイル／フォルダーを開く | `Ctrl+O` / `Ctrl+Shift+O`     |
| ページ内／ディレクトリ検索 | `Ctrl+F` / `Ctrl+Shift+F`     |
| 戻る／進む                 | `Alt+Left` / `Alt+Right`      |
| 次／前のタブ               | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| アクティブタブを閉じる     | `Ctrl+W`                      |
| エクスプローラー／目次切替 | `Ctrl+B` / `Ctrl+J`           |
| 設定を開く                 | `Ctrl+,`                      |
| 本文ズーム                 | `Ctrl++`、`Ctrl+-`、`Ctrl+0`  |

タイトルバーのハンバーガーボタンから、利用可能なコマンドを含むネイティブアプリメニューを表示できます。

## インストール

リリースパッケージは[GitHub Releases](https://github.com/cocoabreak/feathermd/releases)で公開します。

リリースバイナリにはコード署名を付けていません。そのため、Windows Defender SmartScreenに「認識されないアプリ」の警告が表示される場合があり、macOSでも未公証のアプリとして明示的な許可が必要になる場合があります。FeatherMDは必ず上記の公式Releasesページからダウンロードし、OSの警告を回避する前に入手元が信頼できることを確認してください。

| プラットフォーム              | サポート水準 | 配布に関する補足                                                                                                       |
| ----------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Windows x64                   | 最優先       | MSI・NSIS（`.exe`）インストーラーと`FeatherMD_<version>_x64-portable.zip`。Microsoft Edge WebView2 Runtimeが必要です。 |
| Linux x64                     | Best effort  | CIで生成したパッケージを公開します。デスクトップ統合の動作はディストリビューションにより異なる場合があります。         |
| macOS（Apple Silicon／Intel） | 試験的       | Universal版をCIで生成しますが、サポート優先度は最も低く、アプリは公証されていません。                                  |

### ビルドの前提環境

以下はソースコードからビルドする場合にのみ必要です。

- Node.js 24 LTS
- RustおよびCargo
- Tauri v2が各OSで要求するビルド環境
- Windows: Microsoft Edge WebView2 Runtime（現在のWindows 11には標準搭載）

### ソースコードからビルド・実行

```bash
git clone https://github.com/cocoabreak/feathermd.git
cd feathermd/app
npm ci
npm run tauri dev
```

releaseビルドを作成する場合:

```bash
npm run tauri build
```

### 品質チェック

フロントエンドの検査は`app/`で実行します。

```bash
npm run format
npm run lint
npm run check
npm test
```

Rustの検査は`app/src-tauri/`で実行します。

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

## コントリビューション

開発への参加方法は[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。機能仕様と設計判断は[`.kiro/specs`](.kiro/specs)と[`docs/decisions`](docs/decisions)で管理しています。

リリース履歴は[CHANGELOG](CHANGELOG.md)を参照してください。

## 免責事項

FeatherMDは独立したオープンソースプロジェクトです。「Feather」の名称を持つ他の製品またはプロジェクトとの提携、資金提供、承認関係はありません。

## ライセンス

FeatherMDは[MIT License](LICENSE)で公開されています。
