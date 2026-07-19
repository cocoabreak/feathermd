# 技術設計: レンダラーのプラグイン化 (renderer-plugins)

## ステータス

完了

## 全体像

```
app/src/lib/plugins/
├── types.ts          # ViewerPlugin インターフェース
├── index.ts          # import.meta.glob によるビルド時自動収集
├── README.md         # プラグイン作成規約（コントリビューター向け）
├── plugins.test.ts   # プラグイン契約のユニットテスト
├── mermaid/
│   ├── index.ts      # プラグイン定義（fence + postRender）
│   └── post.ts       # 遅延SVG化（旧 markdown/mermaid-post.ts を移設）
└── katex/
    └── index.ts      # プラグイン定義（extendMarkdownIt、ADR-010の注入を内包）
```

削除: `markdown/registry.ts`、`markdown/renderers/mermaid.ts`、`markdown/mermaid-post.ts`、`markdown/types.ts`

## プラグインインターフェース

markdown-itのfenceルールは**同期関数**であるため、非同期・DOM必須のレンダリング（Mermaid等）は「fenceで同期的にプレースホルダーを返し、DOM挿入後の後処理で実レンダリングする」二段構えに固定される。拡張ポイントは3つ:

```ts
export interface ViewerPlugin {
  /** 設定キー兼識別子（settings.renderers のキーになる） */
  name: string;
  /** 設定パネルに表示する名前 */
  displayName: string;
  /** 設定パネルに表示する補足説明 */
  description: string;
  /** 初回起動時のON/OFF初期値 */
  defaultEnabled: boolean;

  /** ① 構文拡張型（KaTeX）: markdown-itインスタンスへの介入。重い依存はここで動的import */
  extendMarkdownIt?(md: MarkdownIt): Promise<void> | void;

  /** ② fence引き受け型（Mermaid, 将来のKroki）: 同期でプレースホルダーHTMLを返す */
  fence?: {
    languages: string[];
    render(code: string, lang: string): string;
  };

  /** ③ DOM挿入後の後処理: 重い非同期処理はここ。cleanup関数を返す。
   *  自プラグインのマーカー要素が存在しないときは何もしないこと（無効時も呼ばれる） */
  postRender?(container: HTMLElement): (() => void) | void;
}
```

各 `plugins/<name>/index.ts` は `ViewerPlugin` を **default export** する。

## 収集方式: ビルド時自動収集

```ts
// plugins/index.ts
const modules = import.meta.glob<{ default: ViewerPlugin }>("./*/index.ts", { eager: true });
export const viewerPlugins: ViewerPlugin[] = Object.keys(modules).sort().map((p) => modules[p].default);
```

- Viteがビルド時にディレクトリを走査して静的に解決する（実行時の動的発見なし）
- `eager: true` で読まれるのは各 `index.ts` の軽量な**定義**のみ。mermaid/katex本体などの重い依存は各プラグインが `extendMarkdownIt` / `postRender` 内で `await import()` する。これにより現行のチャンク分割・遅延ロード（初回起動速度）を維持する
- 収集順はglobキーのアルファベット順で決定的。現時点のプラグイン（互いに独立した言語・構文を扱う）では順序制御は不要

### 代替案の比較

| 案 | 利点 | 欠点 | 判断 |
|---|---|---|---|
| `import.meta.glob` 自動収集 | ディレクトリを置くだけ。編集箇所ゼロで貢献障壁が最小 | 登録が暗黙的 | **採用** |
| `index.ts` に明示import | 登録が目に見える | 追加手順に「index.ts編集」が入る | 不採用 |
| 実行時動的ロード（Eclipse型） | 再ビルド不要 | 複雑・セキュリティ境界が崩れる・要求にない | 不採用 |

## コアとの接続

### engine.ts（フェーズ1: HTML生成）

- 有効判定: `options.renderers[plugin.name] ?? plugin.defaultEnabled`
- md構築後、有効なプラグインの `extendMarkdownIt` を順にawait（例外はcatchして当該プラグインをスキップ）
- fenceルール: 有効なプラグインの `fence.languages` から言語→プラグインのMapを構築し、ヒットしたら `fence.render` を呼ぶ。例外時はshikiハイライトへフォールバック
- `RenderOptions` は `{ renderers: Record<string, boolean>; codeTheme; showLineNumbers }` に変更

### MarkdownViewer.svelte（フェーズ2: DOM後処理）

- 旧 `setupLazyMermaid` 直接呼び出しを、全プラグインの `postRender` イテレーションに置換（cleanup関数の配列を保持し、再レンダリング前に全解放）
- `postRender` は有効/無効に関わらず呼ぶ（無効ならfenceが動いておらずマーカー要素が存在しないため自然にno-op）。これによりDOM後処理エフェクトが設定への依存を持たずに済む
- 再レンダリング抑制: 旧 `mermaidEnabled` / `katexEnabled` 個別derivedの代わりに `settings.renderers` オブジェクト参照を `$derived` で監視する。トグル時のみ新オブジェクトが生成されるため、無関係な設定変更では再レンダリングされない（従来と等価）

### 設定（自動追従）

- `RendererSettings` を `Record<string, boolean>` に変更。デフォルト値は `viewerPlugins` の `defaultEnabled` から導出
- `settings-store.ts` のロードは既知キー（＝現行プラグインのname）をループで読む。保存済みの未知キー（削除されたプラグインの残骸）は読み捨て
- 既存settings.jsonの `renderers.mermaid` / `renderers.katex` はキー名が同じためマイグレーション不要
- `SettingsPanel.svelte` は `viewerPlugins` をイテレートしてトグルを自動生成（`displayName` + `description` を表示）

## エラー分離

1プラグインの失敗が本文レンダリングを落とさないことをコアの責務とする:

- `extendMarkdownIt` の例外 → warnログを出して当該プラグインなしで続行
- `fence.render` の例外 → warnログを出してshikiフォールバック
- `postRender` の例外 → warnログを出して他プラグインの後処理は続行

プラグイン内部の丁寧なエラーUI（Mermaidのタイムアウト＋エラー詳細表示）はプラグインの責務として維持する。

## セキュリティ

- プラグイン出力は従来どおり `sanitize.ts` のDOMPurify（html + mathMl + svg、form禁止）を通る。プラグインによる許可リスト拡張はv1では提供しない
- プラグインはビルド時に一体化される内製コードであり、実行時の信頼境界は設けない。コアAPI（`$lib` 配下）の直接importを許容するが、規約としてユーティリティ層の利用に留め、ストアの直接変更は不可とする（README.mdに明記）

## 破棄する旧構造

- `markdown/types.ts` の `RendererType`（`js-native | external-process | cloud-api`）と `ExternalProcessConfig` / `CloudApiConfig` は未使用のv2構想スタブ。新インターフェースでは外部プロセス型・クラウドAPI型も「fence + postRender（内部でTauriコマンド/HTTP）」で表現できるため型は不要。構想はbacklogへ移す
- `markdown/registry.ts` の `RendererRegistry` はどこからも参照されていないため削除
