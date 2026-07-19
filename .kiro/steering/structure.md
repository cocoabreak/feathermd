---
inclusion: always
---

# プロジェクト構造

## ディレクトリ構成

```
feathermd/
├── .kiro/
│   ├── steering/           # AI共通コンテキスト（常時参照）
│   │   ├── product.md      # プロダクトビジョン・目標
│   │   ├── conventions.md  # 開発規約
│   │   └── structure.md    # このファイル
│   └── specs/              # 機能仕様（フィーチャー単位）
│       └── <feature>/
│           ├── requirements.md  # 要求・受け入れ条件
│           ├── design.md        # 技術設計
│           └── tasks.md         # 実装タスク
├── .agents/
│   └── skills/                   # Codex用のプロジェクト固有ワークフロー
│       ├── review-design-diff/   # 設計・差分レビュー
│       ├── review-security/      # セキュリティレビュー
│       └── run-feathermd/         # 実アプリ起動・操作・確認
├── docs/
│   └── decisions/          # 意思決定記録 (ADR)
├── CLAUDE.md               # Claude Code用（steering/を参照）
├── GEMINI.md               # Gemini用（steering/を参照）
├── AGENTS.md                # Codex用（steering/を参照）
├── .gitattributes          # LF強制
└── .gitignore
```

実装ディレクトリ構造はアーキテクチャ確定後にここへ追記する。

## 仕様駆動開発フロー

```
要求定義 (requirements.md)
  → 技術設計 (design.md)
    → 実装タスク (tasks.md)
      → 実装・テスト
```

## 意思決定記録 (ADR)

`docs/decisions/` にADR形式で記録する。
ファイル名: `ADR-NNN-YYYYMMDD-タイトル.md`
