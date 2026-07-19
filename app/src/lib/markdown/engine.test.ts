import { describe, expect, it } from "vitest";
import { cancelMarkdownRender, renderMarkdown } from "./engine";

const options = {
  renderers: {
    mermaid: false,
    katex: false,
    "markdown-dialects": false,
    "wiki-links": false,
  },
  codeTheme: "dark-plus",
  showLineNumbers: false,
};

describe("Markdown render cancellation", () => {
  it("明示キャンセル後はawait中のレンダリング結果を生成しない", async () => {
    const pending = renderMarkdown("# cancelled", options);

    cancelMarkdownRender();

    await expect(pending).resolves.toEqual({ html: "", frontmatter: null });
  });
});
