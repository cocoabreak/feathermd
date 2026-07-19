import type { PostRenderContext, ViewerPlugin } from "../types";
import { renderAllPending, setupLazyMermaid } from "./post";

/**
 * Mermaid図のレンダリングプラグイン。
 * fenceでは同期的にプレースホルダーを返すだけにし、実際のSVG生成は
 * DOM挿入後に post.ts が遅延実行する（二段構え）。
 */
const mermaidPlugin: ViewerPlugin = {
  name: "mermaid",
  version: "1.0.0",
  engine: { displayName: "Mermaid", packageName: "mermaid" },
  displayName: { ja: "Mermaid", en: "Mermaid" },
  description: { ja: "図・フローチャート", en: "Diagrams & flowcharts" },
  defaultEnabled: true,

  fence: {
    languages: ["mermaid"],
    render(code: string): string {
      const encoded = encodeURIComponent(code);
      return `<div class="viewer-plugin viewer-plugin--mermaid mermaid-pending" data-viewer-plugin="mermaid" data-code="${encoded}"></div>\n`;
    },
  },

  postRender(container: HTMLElement, context: PostRenderContext): () => void {
    return setupLazyMermaid(
      container,
      context.locale,
      context.externalImagesAllowed,
      context.onExternalImagesBlocked
    );
  },

  async beforePrint(container: HTMLElement, context: PostRenderContext): Promise<void> {
    await renderAllPending(
      container,
      context.locale,
      context.externalImagesAllowed,
      context.onExternalImagesBlocked
    );
  },
};

export default mermaidPlugin;
