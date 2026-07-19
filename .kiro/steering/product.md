---
inclusion: always
---

# FeatherMD プロダクトコンテキスト

## ビジョン

FeatherMDとして、Markdownファイルを快適に閲覧・操作できるビューワーを開発する。

## 目標

軽量かつMermaid・TeX・Krokiなどのリッチなレンダリングに対応したMarkdown専用ビューワーを提供する。
詳細は `.kiro/specs/core-viewer/requirements.md` を参照。

## 実装基盤

- **フレームワーク**: Tauri v2（Rustバックエンド + WebView2）— ADR-002参照
- **対象OS**: Windows（Must）/ Linux（Nice to have）/ macOS（最低優先度）

## スコープ

- ビューワー専用（編集機能は対象外）
- ローカルファイルシステム上のMarkdownファイルを閲覧する
