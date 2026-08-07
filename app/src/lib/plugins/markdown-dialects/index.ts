// @ts-expect-error: package does not bundle TypeScript declarations
import deflist from "markdown-it-deflist";
import footnote from "markdown-it-footnote";
import type { ViewerPlugin } from "$lib/plugins/types";
import { installCallouts } from "./callouts";
import { ensureCalloutStyles } from "./styles";

const plugin: ViewerPlugin = {
  name: "markdown-dialects",
  version: "1.0.0",
  displayName: {
    ja: "Markdown方言",
    en: "Markdown dialects",
  },
  description: {
    ja: "脚注・GitHub Alerts・定義リストを描画します",
    en: "Render footnotes, GitHub Alerts, and definition lists",
  },
  defaultEnabled: true,
  extendMarkdownIt(md) {
    md.use(footnote);
    md.use(deflist);
    installCallouts(md);
  },
  postRender(container) {
    ensureCalloutStyles(container);
  },
};

export default plugin;
