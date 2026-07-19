# 実装タスク: レンダラーのプラグイン化 (renderer-plugins)

## 1. プラグイン基盤

- [x] 1.1 `plugins/types.ts`: `ViewerPlugin` インターフェースを定義する
- [x] 1.2 `plugins/index.ts`: `import.meta.glob` による自動収集と `defaultRendererSettings()` を実装する
- [x] 1.3 `plugins/README.md`: プラグイン作成規約を文書化する
- [x] 1.4 `plugins/plugins.test.ts`: プラグイン契約（default export・name一意性・必須フィールド）のテストを追加する

## 2. 既存レンダラーの移設

- [x] 2.1 `plugins/mermaid/`: `index.ts`（fence + postRender）と `post.ts`（旧 mermaid-post.ts）を作成する
- [x] 2.2 `plugins/katex/index.ts`: extendMarkdownIt型プラグインとして作成する（ADR-010のESM版katex注入を内包）

## 3. コアの接続変更

- [x] 3.1 `engine.ts`: ハードコードされたmermaid分岐・katexローダーを除去し、プラグインイテレーション（extendMarkdownIt / fence Map / エラー分離）に置換する
- [x] 3.2 `MarkdownViewer.svelte`: `setupLazyMermaid` 直接呼び出しを全プラグインの `postRender` イテレーションに置換する
- [x] 3.3 `settings.svelte.ts`: `RendererSettings` を `Record<string, boolean>` にし、デフォルトをプラグインから導出する
- [x] 3.4 `settings-store.ts`: rendererロードを既知キーのループに置換する
- [x] 3.5 `SettingsPanel.svelte`: レンダラートグルを `viewerPlugins` からの自動生成に置換する

## 4. 旧構造の削除・後始末

- [x] 4.1 `markdown/registry.ts`・`markdown/renderers/mermaid.ts`・`markdown/mermaid-post.ts`・`markdown/types.ts` を削除する
- [x] 4.2 `image-lightbox-trigger.ts` 等のコメント内参照を新パスに更新する
- [x] 4.3 `.kiro/backlog.md`: 外部プロセス型・クラウドAPI型レンダラーの構想を追記する

## 5. 検証

- [x] 5.1 `npm run format` / `lint` / `check` / `test` を通す
- [x] 5.2 実機（CDP）でMermaid・KaTeXの描画、設定トグルのON/OFF反映、設定パネルの自動生成を確認する
