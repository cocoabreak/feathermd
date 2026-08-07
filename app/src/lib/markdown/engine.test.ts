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

describe("Markdown plugin integration", () => {
  it("Callout内部でMermaidとKaTeXを既存プラグイン順序のまま描画する", async () => {
    const result = await renderMarkdown(
      [
        "> [!note] Rich renderers",
        "> Inline math: $E = mc^2$",
        ">",
        "> ```mermaid",
        "> flowchart LR",
        ">   A --> B",
        "> ```",
      ].join("\n"),
      {
        ...options,
        renderers: {
          ...options.renderers,
          mermaid: true,
          katex: true,
          "markdown-dialects": true,
        },
      }
    );

    expect(result.html).toContain('class="callout callout-note"');
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain("mermaid-pending");
    expect(result.html).toContain('data-code="');
  });
});
