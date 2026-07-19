# 要求定義: npm依存整理 (dependency-cleanup)

## 背景

v0.1.0のリリース前監査で、フロントエンドに未参照の直接依存と、本体同梱の型定義に置き換わった型パッケージが見つかった。また、ビルド時だけ使用する依存の一部が`dependencies`に置かれている。

## 受け入れ条件

- [x] 未参照の`bits-ui`とnpm側の`@tauri-apps/plugin-store`を削除する
- [x] 本体同梱型を使用している`@types/dompurify`、`@types/katex`、`@types/js-yaml`を削除する
- [x] `@tailwindcss/vite`、`tailwindcss`、`@types/markdown-it`を`devDependencies`へ移す
- [x] lockfileを同期し、check・lint・test・buildが成功する
- [x] 設計・差分レビューとセキュリティレビューに未解決の重大指摘がない

## 対象外

- Rust依存の変更
- npmパッケージのバージョン更新
- アプリ機能や実行時挙動の変更
