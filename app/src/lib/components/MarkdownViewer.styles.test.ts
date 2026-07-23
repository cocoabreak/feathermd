import { describe, expect, it } from "vitest";
import source from "./MarkdownViewer.svelte?raw";

describe("MarkdownViewer styles", () => {
  it("空のMarkdownでも文書未選択表示へ戻さない", () => {
    expect(source).toContain("{:else if activeContent}");
    expect(source).not.toContain("{:else if renderedHtml}");
    expect(source).not.toContain('if (result.html === "") return');
  });

  it("実文書の表示中だけコンテンツ領域を選択可能にする", () => {
    expect(source).toContain("class:selectable-content={!isLoading && !!activeContent}");
  });

  it("Tailwindのリセット後も通常・入れ子・タスクリストの記号を定義する", () => {
    expect(source).toMatch(/\.markdown-body :global\(ul\)\s*{\s*list-style-type: disc;\s*}/);
    expect(source).toMatch(/\.markdown-body :global\(ol\)\s*{\s*list-style-type: decimal;\s*}/);
    expect(source).toMatch(/\.markdown-body :global\(ul ul\)\s*{\s*list-style-type: circle;\s*}/);
    expect(source).toMatch(
      /\.markdown-body :global\(ul ul ul\)\s*{\s*list-style-type: square;\s*}/
    );
    expect(source).toMatch(/\.markdown-body :global\(\.task-list-item\)\s*{\s*list-style: none;/);
  });

  it("脚注と定義リストのスタイルを定義する", () => {
    expect(source).toContain(".markdown-body :global(dl)");
    expect(source).toContain(".markdown-body :global(dt)");
    expect(source).toContain(".markdown-body :global(dd)");
    expect(source).toContain(".markdown-body :global(.footnotes)");
    expect(source).toContain(".markdown-body :global(.footnote-backref)");
  });

  it("MermaidのノードラベルだけをMermaid既定の行高へ戻す", () => {
    expect(source).toMatch(
      /\.markdown-body :global\(\.mermaid-rendered \.nodeLabel p\)\s*{\s*line-height: 1\.5;\s*}/
    );
    expect(source).toMatch(
      /\.markdown-body :global\(p\)\s*{\s*margin-bottom: 1rem;\s*line-height: 1\.75;\s*}/
    );
  });
});
