import type { PluginWithParams } from "markdown-it";
import type { ViewerPlugin } from "../types";

// KaTeXプラグインは動的importで別チャンクに分離する（Mermaidと同じ方針）。
// 静的importだと数式を使わないファイルでも起動時に必ずロードされてしまうため。
let katexPluginPromise: Promise<PluginWithParams> | null = null;

function getKatexPlugin(): Promise<PluginWithParams> {
  if (!katexPluginPromise) {
    // ADR-010: Vite 8/Rolldown が markdown-it-katex 内の require('katex')（CJS/UMD版
    // dist/katex.js）を再バンドル時に壊し、\frac 等のコマンドが描画されなくなる。
    // ESM版katex（dist/katex.mjs、`import`条件で解決）を options.katex で明示注入して
    // プラグインに使わせる。dev の optimizeDeps 破壊は vite.config の exclude で回避する。
    katexPluginPromise = Promise.all([
      import("@traptitech/markdown-it-katex"),
      import("katex"),
    ]).then(([pluginMod, katexMod]) => {
      const plugin = pluginMod.default as PluginWithParams;
      const katex = katexMod.default;
      const wrapped: PluginWithParams = (md, ...params) => {
        const options = (params[0] as Record<string, unknown> | undefined) ?? {};
        plugin(md, { ...options, katex });
      };
      return wrapped;
    });
  }
  return katexPluginPromise;
}

/** KaTeX数式（インライン $...$ / ブロック $$...$$）の構文拡張プラグイン */
const katexPlugin: ViewerPlugin = {
  name: "katex",
  version: "1.0.0",
  engine: { displayName: "KaTeX", packageName: "katex" },
  displayName: { ja: "KaTeX", en: "KaTeX" },
  description: { ja: "数式 ($...$ / $$...$$)", en: "Math ($...$ / $$...$$)" },
  defaultEnabled: true,

  async extendMarkdownIt(md): Promise<void> {
    const plugin = await getKatexPlugin();
    // throwOnError: false で無効なTeX記法をエラーにせず表示する
    md.use(plugin, {
      throwOnError: false,
      errorColor: "#cc0000",
    });
  },
};

export default katexPlugin;
