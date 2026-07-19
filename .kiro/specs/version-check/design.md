# 技術設計: リリース確認 (version-check)

## ステータス

実装完了

## 構成

```text
startup / AboutDialog
        |
 updateCheckStore
        |
 check_for_updates (Tauri command)
        |
 GitHub REST: cocoabreak/feathermd/releases/latest
```

- WebViewのCSPは広げず、HTTPS通信はRust側だけで行う
- GitHub API URLとリリースページURLはコンパイル時定数とし、フロント入力を受け取らない
- 応答は64KiB、全体タイムアウトは5秒に制限する
- Rust側で同時実行を1件に制限し、成功・失敗結果を30秒間再利用する
- Rustは`tag_name`だけを信頼対象としてSemVer解析し、遷移先は固定のReleases URLを返す
- `updateCheckStore`は同時呼び出しを共有し、起動時とAboutで状態を一元管理する
- 自動確認の失敗はUIへ出さず、手動確認時はAbout内へ表示する
- 新版通知は閉じられる非モーダルUIとし、自動ダウンロードは行わない

## 設定

`Settings.checkForUpdatesOnStartup: boolean`を追加し、既定値を`true`とする。保存済み設定に
キーがない場合も既定値を維持する。無効化してもAboutの手動確認は利用できる。
