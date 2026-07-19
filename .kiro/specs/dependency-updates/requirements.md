# 要求定義: v0.1.0依存更新 (dependency-updates)

## 背景

v0.1.0の公開前に、利用中のnpm・Cargo依存を更新し、既知脆弱性と古いlockfileを監査する。

## 受け入れ条件

- [x] npm直接依存を公式peerDependenciesと互換性のある最新版へ更新する
- [x] Cargo依存を現行のバージョン制約内で更新する
- [x] npm・Cargoのlockfileに意図しないダウングレードを含めない
- [x] format・check・lint・test・buildとRust検査が成功する
- [x] npm auditの結果を確認し、未解消項目の影響と対応方針を記録する
- [x] 設計・差分レビューとセキュリティレビューに未解決の重大指摘がない

## 対象外

- `@typescript-eslint`のpeer範囲外であるTypeScript 7への更新
- 互換性問題を避けるため上限固定しているRust `time` 0.3.52以降への更新
- 脆弱性を解消しない破壊的なダウングレードや、上流の対応を迂回する強制override
