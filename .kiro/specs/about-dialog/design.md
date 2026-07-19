# 技術設計: Aboutダイアログ (about-dialog)

## ステータス

完了

## 1. メニューと状態

- Rustのネイティブメニューへ `help.about` を追加し、既存の `menu-action` イベント経由でフロントエンドへ通知する
- `commands/builtin.ts` が `help.about` を `uiStore.openAbout()` へルーティングする
- `uiStore` はAboutダイアログの一時的な開閉状態だけを保持する

## 2. Aboutダイアログ

- `AboutDialog.svelte` を新設し、既存の `focusTrap` actionを再利用する
- ロゴ、アプリ名、バージョン、著作権、説明、Disclaimer、GitHubリンクを上部へ配置する
- `<details>` で「プラグインとコンポーネント」「ライセンス」を折りたたむ
- プラグイン状態は `settingsStore.settings.renderers` から読み取るだけで変更操作は提供しない
- GitHub URLはコード内の固定HTTPS URLだけを `openUrl` へ渡し、ユーザー入力を扱わない

## 3. バージョンとライセンス情報

- `ViewerPlugin`へ `version` と任意の `engine` メタデータを追加する
- 内蔵プラグインのバージョンは各プラグイン定義に置き、実装変更時に更新する
- Vite設定が `package.json` と `package-lock.json` を読み、アプリと主要依存のバージョン／ライセンスを `__ABOUT_BUILD_INFO__` として静的注入する
- クライアントへlockfile全体をバンドルしない
- 対象コンポーネントは Mermaid、KaTeX、markdown-it、Shiki、DOMPurifyとする

## 4. アクセシビリティ

- `role="dialog"`、`aria-modal="true"`、見出しによるラベルを設定する
- Esc、外側クリック、閉じるボタンを提供する
- `focusTrap`で初期フォーカス、Tab循環、フォーカス復帰を処理する
