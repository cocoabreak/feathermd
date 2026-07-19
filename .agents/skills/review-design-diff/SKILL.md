---
name: review-design-diff
description: Review FeatherMD changes for specification alignment, architectural consistency, regressions, error handling, maintainability, and missing tests. Use after implementation and deterministic checks are complete, before commit or merge, for feature, bug-fix, refactor, dependency, persistence, or cross-layer changes; also use when explicitly asked for a code, design, or diff review.
---

# 設計・差分レビュー

実装者から独立した読み取り専用レビューとして実施する。コードを変更せず、根拠のある指摘を返す。

## 手順

1. `.kiro/steering/`、対象spec、関連ADRを読む。
2. `git status`と対象ブランチの差分を確認し、変更目的と影響範囲を特定する。
3. 要求・設計・タスクの各項目を実装とテストへ対応付ける。
4. 責務分割、失敗時挙動、回帰、ライフサイクル、永続化互換性、重複、過剰設計、テスト不足、specとの矛盾を確認する。
5. Prettier、ESLint、svelte-check、rustfmt、Clippy等が担当する機械的事項は、失敗ログがある場合を除き再指摘しない。

## 出力

問題を重大度順に列挙する。

- `P0`: データ損失、重大障害、リリース不能
- `P1`: 主要機能の不具合、広い回帰
- `P2`: 条件付き不具合、具体的な設計負債、重要なテスト不足
- `P3`: 小さな保守性・明確性の問題

各指摘に、短い題名、ファイルと行、再現条件または根拠、影響、最小の修正方向を含める。推測は推測と明記する。問題がなければ「指摘なし」とし、残る未検証リスクだけを簡潔に示す。好みだけの提案や差分と無関係な改善は含めない。
