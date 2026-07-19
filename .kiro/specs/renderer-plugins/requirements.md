# 要求定義: レンダラーのプラグイン化 (renderer-plugins)

## 背景・動機

Mermaid・KaTeXなどのリッチレンダリングは「プラグイン風」に実装されたが、現状は中途半端な状態にある（2026-07-09時点の調査結果）:

- `markdown/registry.ts` と `markdown/renderers/mermaid.ts` が存在するが、実際のレンダリングパス（`engine.ts` のfenceルール）は `lang === "mermaid"` をハードコードしており、レジストリはどこからも参照されていない（実質デッドコード）
- KaTeXは `$...$` 構文拡張（markdown-itプラグイン）であり、fence前提の `Renderer` インターフェースに収まらないため `renderers/katex.ts` が存在しない（拡張ポイントが1種類しか定義されていないことが原因の非対称）
- Mermaidの実装が `renderers/mermaid.ts` と `markdown/mermaid-post.ts`（DOM挿入後の遅延SVG化）に分散し、後者を `MarkdownViewer.svelte` が直接importしている
- レンダラー設定（`RendererSettings { mermaid, katex }`）・エンジン・設定UIの3箇所がレンダラー名をハードコードしており、レンダラー追加のたびに全箇所の修正が必要

## 目的

メインのビューワー機能と表現拡張（レンダラー）を分離し、**1レンダラー = 1ディレクトリ**に関連実装を集約する。第三者が規約に沿ってディレクトリを追加するだけで新しいレンダラーを組み込めるようにする。

## スコープ

- **対象**: Mermaid・KaTeXのプラグイン化、プラグインインターフェースの定義、ビルド時の自動収集、設定UI・設定永続化の自動追従
- **対象外**:
  - 実行時の動的プラグイン発見（Eclipse型）。ビルド時解決のみとする
  - emoji・taskListsのプラグイン化（CommonMark+GFM相当はビューワーコア機能とする）
  - プラグインによるsanitize許可リストの拡張宣言（必要になったプラグインが現れた時点で個別判断）
  - 外部プロセス型・クラウドAPI型レンダラーの実装（構想はbacklogへ）

---

## ユーザーストーリー

### US-001: レンダラーを1ディレクトリで追加できる（開発者向け）

```
As a コントリビューター
I want to plugins/配下に規約に沿ったディレクトリを1つ追加する
So that エンジン・設定・UIのコードを変更せずに新しいレンダラーを組み込める
```

**受け入れ条件**

- [x] `plugins/<name>/index.ts` を置くだけでビルドに含まれ、レンダリングに参加する
- [x] 設定パネルのレンダラーON/OFFトグルが自動的に生える
- [x] 設定の永続化（settings.json）も自動追従する
- [x] プラグインの書き方が `plugins/README.md` に規約として文書化されている

### US-002: 既存機能が同一動作を維持する

```
As a ユーザー
I want to Mermaid・KaTeXが従来どおり描画される
So that 内部構造の変更を意識せずに使い続けられる
```

**受け入れ条件**

- [x] Mermaidの遅延レンダリング（IntersectionObserverによるビューポート近傍のみ描画）・タイムアウト・エラー表示・拡大ボタンが維持される
- [x] KaTeXのインライン/ブロック数式が維持される（ADR-010のESM版katex注入を含む）
- [x] 既存のsettings.jsonの `renderers.mermaid` / `renderers.katex` がマイグレーションなしでそのまま読める
- [x] 初回起動速度・チャンク分割が劣化しない（mermaid/katex本体の動的importによる遅延ロードを維持）

### US-003: プラグインの失敗がビューワーを壊さない

```
As a ユーザー
I want to あるレンダラーが失敗しても本文は表示され続ける
So that 1つの図の問題でドキュメント全体が読めなくなることがない
```

**受け入れ条件**

- [x] プラグインの各フック（markdown-it拡張・fence・DOM後処理）の例外をコア側が捕捉する
- [x] fence処理が失敗したコードブロックは通常のコードハイライトにフォールバックする

---

## 未決定事項（設計フェーズで決定）

- [x] プラグインの収集方式（`import.meta.glob` 自動収集 vs `index.ts` 明示登録）→ 自動収集を採用（design.md参照）
- [x] v1でプラグイン化する範囲 → Mermaid + KaTeXのみ。境界基準は「CommonMark+GFM相当＝コア、それ以外の表現拡張＝プラグイン」
- [x] sanitize許可リストのプラグインによる拡張宣言 → v1では見送り。グローバルプロファイル（html + mathMl + svg、form禁止）固定
- [x] 未使用のv2スタブ型（`external-process` / `cloud-api`）の扱い → 削除し、構想をbacklogへ移す
