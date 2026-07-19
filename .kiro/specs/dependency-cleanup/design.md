# 技術設計: npm依存整理 (dependency-cleanup)

## ステータス

完了

## 設計

- ソース、設定、CI、TypeScript型解決ログに基づき、未使用と確認できた直接依存だけを削除する
- Rust側の`tauri-plugin-store`は永続化に使用しているため維持し、未使用のnpm bindingsだけを削除する
- DOMPurify、KaTeX、js-yamlは各パッケージ本体が公開する型定義を使用する
- TailwindのVite連携とCSS処理、およびMarkdown-itの型定義はビルド時だけ必要なため`devDependencies`へ移す
- `package-lock.json`はnpmで機械的に再生成し、解決済みバージョンを不用意に更新しない

## リスクと検証

- 暗黙的な型依存の削除による型エラーは`npm run check`で検出する
- ビルド時依存の分類変更によるバンドル失敗は`npm run build`で検出する
- テスト環境への影響は`npm test`、設定とimportの不整合は`npm run lint`で検出する
