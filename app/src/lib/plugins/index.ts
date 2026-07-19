import type { ViewerPlugin } from "./types";

export type { LocalizedText, PostRenderContext, ViewerPlugin } from "./types";

// ビルド時にplugins/配下のディレクトリを走査して静的にバンドルする（実行時の動的発見はしない）。
// eagerに読むのは各index.tsの軽量な定義のみ。mermaid等の重い依存は各プラグインが
// extendMarkdownIt / postRender 内で動的importするため、初回起動速度には影響しない。
const modules = import.meta.glob<{ default: ViewerPlugin }>("./*/index.ts", { eager: true });

/** 収集された全プラグイン（globキーのアルファベット順で決定的） */
export const viewerPlugins: ViewerPlugin[] = Object.keys(modules)
  .sort()
  .map((path) => modules[path].default);

/** プラグインの defaultEnabled から settings.renderers の初期値を導出する */
export function defaultRendererSettings(): Record<string, boolean> {
  return Object.fromEntries(viewerPlugins.map((p) => [p.name, p.defaultEnabled]));
}
