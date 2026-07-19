---
name: review-security
description: Perform a threat-focused security review of FeatherMD changes. Use before commit or merge whenever changes touch filesystem access, trusted roots, paths, HTML/SVG/CSS rendering or sanitization, Tauri commands/capabilities/CSP, external URLs or processes, plugins, persistence, CLI or drag-and-drop input, watchers, exports, or dependency security; also use when explicitly asked for a security review.
---

# セキュリティレビュー

攻撃者視点の読み取り専用レビューとして実施する。コードを変更せず、実行可能な攻撃経路と境界違反を優先する。

## 手順

1. ADR-009、`security-hardening` spec、CSP、capability、関連するRustコマンドとフロント呼び出しを読む。
2. 変更前後のデータフローを、入力元から危険な処理まで追跡する。
3. WebViewとRust、信頼済みルート、HTML/SVG/CSS、Tauri権限、外部連携、永続化入力、watcher、新規依存関係の境界を確認する。
4. 入力検証がフロントだけで完結していないか、拒否がfail-closedか、エラー表示自体が注入経路にならないか確認する。
5. 現実的な攻撃入力または失敗条件を示せない指摘は、断定せず未確認リスクとして分離する。

## 重点項目

- canonicalize、シンボリックリンク、パストラバーサル、TOCTOU
- Markdown、HTML、SVG、Mermaid、KaTeX、CSS、DOM挿入
- invoke/event、capability、CSP、asset protocol
- URL、外部プロセス、CLI、ドラッグ＆ドロップ、エクスポート
- watcherの解除漏れ、競合、サイズ・回数制限、リソース枯渇

## 出力

問題を重大度順に列挙する。

- `P0`: 任意コード実行、広範な機密情報漏えい、破壊的な任意ファイル操作
- `P1`: 信頼境界の回避、保存型注入、権限の大幅な過剰付与
- `P2`: 条件付きの情報漏えい・DoS・TOCTOU・防御不足
- `P3`: 防御強化、監査性、限定的な安全性改善

各指摘に、短い題名、ファイルと行、攻撃または失敗シナリオ、影響、最小の修正方向を含める。問題がなければ「指摘なし」とし、確認済みの境界と残る未検証リスクを簡潔に示す。一般論や脅威モデルと無関係な品質指摘は含めない。
