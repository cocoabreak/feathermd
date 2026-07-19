# レンダラープラグイン作成ガイド

このディレクトリ配下に **1レンダラー = 1ディレクトリ** で表現拡張（Mermaid・KaTeXなど）を実装する。
ビルド時に `index.ts`（このディレクトリ直下）の `import.meta.glob` が自動収集するため、
規約に沿ったディレクトリを置くだけでエンジン・設定パネル・設定永続化に組み込まれる。
コアのコード変更は不要。

## 最小構成

```
plugins/
└── <name>/
    └── index.ts   # ViewerPlugin を default export する（必須）
```

`<name>` ディレクトリ内のファイル構成は自由（実装が大きい場合は分割してよい。例: `mermaid/post.ts`）。

## プラグイン定義

`types.ts` の `ViewerPlugin` を default export する:

```ts
import type { ViewerPlugin } from "../types";

const myPlugin: ViewerPlugin = {
  name: "my-renderer", // 設定キー兼識別子。ディレクトリ名と揃える
  version: "1.0.0", // 内蔵プラグイン自体のバージョン（SemVer）
  displayName: { ja: "MyRenderer", en: "MyRenderer" }, // 設定パネルの表示名（言語別）
  description: { ja: "何を描画するか", en: "What it renders" }, // 設定パネルの補足説明（言語別）
  defaultEnabled: true, // 初回起動時のON/OFF

  // 外部レンダリングエンジンを使用する場合のみ指定する。
  // バージョンは package-lock.json からAbout画面へ自動反映される
  engine: { displayName: "MyEngine", packageName: "my-engine" },

  // 以下のフックは必要なものだけ実装する
  extendMarkdownIt?, fence?, postRender?, beforePrint?,
};

export default myPlugin;
```

## 拡張ポイント

markdown-itのfenceルールは**同期関数**のため、非同期・DOM必須のレンダリングは
「fenceで同期的にプレースホルダーを返し、postRenderで実レンダリングする」二段構えで実装する。

| フック                            | 用途                                                 | 実例                                           |
| --------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `extendMarkdownIt(md)`            | 構文拡張（markdown-itプラグインの適用）。非同期可    | KaTeX（`$...$`）、Wikiリンク                   |
| `fence.render(code, lang)`        | コードブロックの引き受け。**同期**でHTML文字列を返す | Mermaid（プレースホルダー生成）                |
| `postRender(container, context)`  | DOM挿入後の後処理。cleanup関数を返す                 | Mermaid（遅延SVG化）、Wikiリンク（リンク解決） |
| `beforePrint(container, context)` | 印刷（PDF出力）直前に遅延レンダリング等を完了させる  | Mermaid（未描画の図の即時レンダリング）        |

`postRender` / `beforePrint` の第2引数 `PostRenderContext` には表示中ファイルのパス・
エクスプローラーのルート・.gitignore考慮設定・現在の表示言語（`locale`）が入る（`types.ts` 参照）。
ストアを直接importせず、必要な情報はここから取ること。

## 守るべきルール

- fence型レンダラーのルート要素には、カスタムCSSの安定した境界として
  `viewer-plugin viewer-plugin--<name>`クラスと`data-viewer-plugin="<name>"`属性を付ける。
  ユーザーCSSはコアによって`.markdown-body`配下へスコープされるため、プラグイン固有の
  スタイル契約は`.markdown-body [data-viewer-plugin="<name>"]`配下で提供する

- **重いライブラリは必ず動的import**（`await import("...")`）で読み込む。プラグイン定義
  （`index.ts` のトップレベル）は起動時に必ず評価されるため、静的importすると全ユーザーの
  起動時間に跳ねる。フック内で初めてimportすれば、Viteが別チャンクに分割し遅延ロードされる
- `postRender` はプラグインの有効/無効に関わらず毎回呼ばれる。自プラグインのマーカー要素
  （fenceで出力したクラス等）が存在しないときは何もしないこと
- 出力HTMLは最終的にDOMPurify（`markdown/sanitize.ts`、html + mathMl + svgプロファイル）を
  通る。許可リストの拡張は提供しない。ユーザー由来の文字列を`innerHTML`へ直接埋め込まず、
  `textContent`やエンコードを使うこと
- コアの `$lib` 配下のimportはユーティリティ関数（例: `image-lightbox-trigger.ts`）に留め、
  ストア（`$lib/stores/`）を直接変更しないこと
- フック内の例外はコア側が捕捉して当該プラグインだけをスキップするが、ユーザーに原因を
  見せたいエラー（構文エラー等）はプラグイン内でUIとして表示すること（Mermaidのエラー表示が実例）
- **文言の多言語対応は自己完結させる**。`displayName` / `description` は `LocalizedText`
  （全対応言語のキーを持つオブジェクト）で定義し、実行時に表示する文言（エラー・ツールチップ等）は
  プラグイン内に言語別の辞書を持ち `PostRenderContext.locale` で選ぶ。コアの辞書
  （`$lib/i18n/ja.ts` / `en.ts`）にプラグインの文言を追加しないこと（Mermaid・Wikiリンクが実例）

## 動作確認

- `plugins.test.ts` が契約（default export・必須フィールド・SemVer形式のversion・name一意性・
  displayName/descriptionの全言語網羅・engine指定時の依存関係）を自動検証する
- 実機確認は `npm run tauri dev` または `.claude/skills/run-feathermd`（CDP駆動）を使う
