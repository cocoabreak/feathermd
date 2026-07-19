# 技術設計: v0.1.0依存更新 (dependency-updates)

## ステータス

完了

## 更新方針

- npmは`npm outdated`の`wanted`を更新し、TypeScriptだけは`@typescript-eslint`が許容する最新の6.0.3を採用する
- TypeScript 7.0.2は`@typescript-eslint` 8.63.0のpeer範囲`>=4.8.4 <6.1.0`外のため見送る
- Cargoは`cargo update`でCargo.tomlの互換範囲内に限定して更新する
- 直接依存で最低バージョンを明示している`ignore`、`regex`、`open`は更新後のバージョンへ合わせる
- Rust `time`は`cookie`との既知互換性のため`<0.3.52`を維持する

## npm audit

更新前は`@sveltejs/kit`から`cookie <0.7.0`へ至るlow severity advisoryが1件あり、影響する直接依存を含め3件と集計される。現時点のSvelteKit最新版2.69.2も対象で、`npm audit fix`は古い0.0.xへの破壊的ダウングレードを提示するため適用しない。FeatherMDはstatic adapterでサーバーCookie処理を配布しないが、上流修正版が公開された時点で更新する。

## 検証

- npm: `npm run format`、`npm run check`、`npm run lint`、`npm test`、`npm run build`
- Rust: `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test`
- 統合: Tauri release buildと起動スモークテスト
- 監査: `npm outdated`、`npm audit`、lockfile差分、設計・セキュリティレビュー
