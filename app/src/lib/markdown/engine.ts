import MarkdownIt from "markdown-it";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import getWasm from "shiki/wasm";
// @ts-expect-error: no bundled types
import taskLists from "markdown-it-task-lists";
import { full as emojiPlugin } from "markdown-it-emoji";
import { viewerPlugins, type ViewerPlugin } from "$lib/plugins";
import { sanitizeHtml } from "./sanitize";
import { extractFrontmatter } from "./frontmatter";

export interface RenderOptions {
  /** プラグインname→有効フラグ（settings.renderers） */
  renderers: Record<string, boolean>;
  codeTheme: string;
  showLineNumbers: boolean;
}

const HIGHLIGHT_THEME_LOADERS = {
  "dark-plus": () => import("@shikijs/themes/dark-plus"),
  "light-plus": () => import("@shikijs/themes/light-plus"),
  "github-dark": () => import("@shikijs/themes/github-dark"),
  "github-light": () => import("@shikijs/themes/github-light"),
  dracula: () => import("@shikijs/themes/dracula"),
  nord: () => import("@shikijs/themes/nord"),
  "one-dark-pro": () => import("@shikijs/themes/one-dark-pro"),
};
// （createHighlighterのlangs指定はビルド時ではなく実行時のフィルタでしかない）。
// 使う言語だけをビルドに含めるため、shiki/core + 言語ごとの個別importで構成する
// （fine-grained bundle）。HIGHLIGHT_LANGSはこのキー一覧から導出し、二重管理を避ける。
const HIGHLIGHT_LANG_LOADERS = {
  typescript: () => import("@shikijs/langs/typescript"),
  javascript: () => import("@shikijs/langs/javascript"),
  tsx: () => import("@shikijs/langs/tsx"),
  jsx: () => import("@shikijs/langs/jsx"),
  svelte: () => import("@shikijs/langs/svelte"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  python: () => import("@shikijs/langs/python"),
  java: () => import("@shikijs/langs/java"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  bash: () => import("@shikijs/langs/bash"),
  sh: () => import("@shikijs/langs/sh"),
  powershell: () => import("@shikijs/langs/powershell"),
  json: () => import("@shikijs/langs/json"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  xml: () => import("@shikijs/langs/xml"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  sql: () => import("@shikijs/langs/sql"),
  markdown: () => import("@shikijs/langs/markdown"),
  diff: () => import("@shikijs/langs/diff"),
  mermaid: () => import("@shikijs/langs/mermaid"),
  cobol: () => import("@shikijs/langs/cobol"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  dotenv: () => import("@shikijs/langs/dotenv"),
  "git-commit": () => import("@shikijs/langs/git-commit"),
  "git-rebase": () => import("@shikijs/langs/git-rebase"),
  graphql: () => import("@shikijs/langs/graphql"),
  http: () => import("@shikijs/langs/http"),
  ini: () => import("@shikijs/langs/ini"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  groovy: () => import("@shikijs/langs/groovy"),
  latex: () => import("@shikijs/langs/latex"),
  log: () => import("@shikijs/langs/log"),
} as const;

const HIGHLIGHT_LANGS = Object.keys(
  HIGHLIGHT_LANG_LOADERS
) as (keyof typeof HIGHLIGHT_LANG_LOADERS)[];

// shiki ハイライターをシングルトンで初期化
let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: Object.values(HIGHLIGHT_THEME_LOADERS).map((load) => load()),
      langs: Object.values(HIGHLIGHT_LANG_LOADERS).map((load) => load()),
      engine: createOnigurumaEngine(getWasm),
    });
  }
  return highlighterPromise;
}

// アプリ起動直後（ファイル選択待ちの間）にshikiの初期化を先行させ、
// 初回レンダリングの体感待ち時間を減らす。結果は待たず、失敗しても
// 通常の初回レンダリング時に再度getHighlighter()が呼ばれるだけなので無視する。
export function warmupHighlighter(): void {
  getHighlighter().catch(() => {});
}

/** プラグインの有効判定（設定に未登録の新プラグインはdefaultEnabledに従う） */
function isPluginEnabled(plugin: ViewerPlugin, renderers: Record<string, boolean>): boolean {
  return renderers[plugin.name] ?? plugin.defaultEnabled;
}

// 進行中のレンダリングをキャンセルするためのバージョン管理
let currentRenderVersion = 0;

/** await区間にある進行中レンダリングを、同期HTML生成へ進む前に無効化する。 */
export function cancelMarkdownRender(): void {
  currentRenderVersion++;
}

export interface RenderResult {
  html: string;
  frontmatter: Record<string, unknown> | null;
}

// 有効プラグインの組み合わせ（signature）ごとにMarkdownItインスタンスをキャッシュする。
// new MarkdownIt() とプラグイン適用は比較的重く、ファイル切替のたびに作り直すと無駄なため、
// 構成が同じ間は再利用する。テーマ・行番号などレンダリング時に変わる設定はインスタンス構造に
// 影響しないので、fenceレンダラーが activeRenderOptions から都度読む。
const mdCache = new Map<string, MarkdownIt>();

// fenceレンダラーが参照する「現在のレンダリング設定」。md.render() は同期実行で、直前に
// 設定してから内部でawaitを挟まないため、複数レンダリングが並行しても取り違えは起きない。
let activeRenderOptions: RenderOptions | null = null;

/** 有効プラグインの並びからキャッシュキーを作る（テーマ等は含めない） */
function rendererSignature(renderers: Record<string, boolean>): string {
  return viewerPlugins
    .filter((p) => isPluginEnabled(p, renderers))
    .map((p) => p.name)
    .join(",");
}

/** signatureに対応するMarkdownItを取得する（未生成なら構築してキャッシュ） */
async function getMarkdownIt(
  renderers: Record<string, boolean>,
  highlighter: HighlighterCore
): Promise<MarkdownIt> {
  const signature = rendererSignature(renderers);
  const cached = mdCache.get(signature);
  if (cached) return cached;

  const md = new MarkdownIt({
    html: true, // ローカルファイルビューワーのため生HTMLを許可
    linkify: true,
    breaks: false,
  });

  // タスクリスト（GFM）
  md.use(taskLists, { enabled: true, label: true });

  // 絵文字ショートコード（GitHub gemoji形式 :trophy: など）
  md.use(emojiPlugin);

  // 有効なプラグインの構文拡張（KaTeX等）を適用する。
  // 1プラグインの失敗で本文レンダリング全体を落とさないため、例外は握って続行する
  for (const plugin of viewerPlugins) {
    if (!plugin.extendMarkdownIt || !isPluginEnabled(plugin, renderers)) continue;
    try {
      await plugin.extendMarkdownIt(md);
    } catch (e) {
      console.warn(`plugin extendMarkdownIt error (${plugin.name}):`, e);
    }
  }

  // 有効なプラグインが引き受けるfence言語 → プラグインのマップ
  const fenceByLang = new Map<string, ViewerPlugin>();
  for (const plugin of viewerPlugins) {
    if (!plugin.fence || !isPluginEnabled(plugin, renderers)) continue;
    for (const lang of plugin.fence.languages) {
      fenceByLang.set(lang.toLowerCase(), plugin);
    }
  }

  // 行番号をDOM要素に埋め込むプラグイン
  md.core.ruler.push("source_line", (state) => {
    state.tokens.forEach((token) => {
      if (token.map && token.type !== "inline" && token.type !== "text") {
        // token.map[0] は0始まりの開始行番号なので、+1して1始まりにする
        token.attrSet("data-source-line", String(token.map[0] + 1));
      }
    });
  });

  // コードブロックレンダラーをオーバーライド。テーマ・行番号は都度 activeRenderOptions から読む
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0].toLowerCase();
    const code = token.content;

    // プラグインが引き受ける言語（Mermaid等）はプラグインに委譲する。
    // 失敗時は通常のコードハイライトへフォールバック
    const fencePlugin = fenceByLang.get(lang);
    if (fencePlugin?.fence) {
      try {
        return fencePlugin.fence.render(code, lang);
      } catch (e) {
        console.warn(`plugin fence error (${fencePlugin.name}, lang=${lang}):`, e);
      }
    }

    const codeTheme = activeRenderOptions?.codeTheme ?? "dark-plus";
    const showLineNumbers = activeRenderOptions?.showLineNumbers ?? false;

    // shiki によるコードハイライト
    try {
      const html = highlighter.codeToHtml(code, {
        lang: (HIGHLIGHT_LANGS as readonly string[]).includes(lang) ? lang : "text",
        theme: Object.keys(HIGHLIGHT_THEME_LOADERS).includes(codeTheme) ? codeTheme : "dark-plus",
      });
      if (showLineNumbers) {
        return html.replace('<pre class="shiki', '<pre class="shiki line-numbers');
      }
      return html;
    } catch (e) {
      console.warn(`shiki highlight error (lang=${lang}):`, e);
      return `<pre><code>${md.utils.escapeHtml(code)}</code></pre>\n`;
    }
  };

  mdCache.set(signature, md);
  return md;
}

export async function renderMarkdown(raw: string, options: RenderOptions): Promise<RenderResult> {
  // このレンダリングのバージョン番号を取得
  const version = ++currentRenderVersion;

  const highlighter = await getHighlighter();
  const md = await getMarkdownIt(options.renderers, highlighter);

  // より新しいレンダリングが始まっていたらキャンセル
  if (version !== currentRenderVersion) {
    return { html: "", frontmatter: null };
  }

  const { data: frontmatter, content } = extractFrontmatter(raw);

  // イベントループを解放してから同期レンダリングを実行
  // （大きいファイルで render() が長時間ブロックする前に UI を更新させる）
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  if (version !== currentRenderVersion) {
    return { html: "", frontmatter: null };
  }

  // fenceレンダラーが読む設定を、同期実行される md.render() の直前に確定させる
  activeRenderOptions = options;
  try {
    return { html: sanitizeHtml(md.render(content)), frontmatter };
  } catch (e) {
    console.error("markdown-it render error:", e);
    throw e;
  }
}
