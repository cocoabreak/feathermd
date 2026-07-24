import { describe, expect, it } from "vitest";
import { buildLinkGraph } from "$lib/link-graph";
import type { DocumentLinkEdge, LinkContextSection } from "$lib/stores/links.svelte";

const current = { sourceId: "source-1", path: "current.md" };

function edge(
  sourcePath: string,
  targetPath: string | null,
  rawTarget: string | null = null
): DocumentLinkEdge {
  return {
    source: { sourceId: "source-1", path: sourcePath },
    target: targetPath ? { sourceId: "source-1", path: targetPath } : null,
    rawTarget,
    anchor: null,
    kind: "markdown",
    referenceCount: 1,
  };
}

function section(
  items: DocumentLinkEdge[],
  total: number | null = items.length
): LinkContextSection {
  return { items, total };
}

describe("buildLinkGraph", () => {
  it("入出力の同一文書を1ノードへ統合し、リンク切れを仮想ノードにする", () => {
    const graph = buildLinkGraph(
      current,
      section([edge("current.md", "shared.md"), edge("current.md", null, "missing.md")]),
      section([edge("shared.md", "current.md")]),
      section([edge("current.md", null, "missing.md")])
    );

    expect(graph.nodes.filter((node) => node.path === "shared.md")).toHaveLength(1);
    expect(graph.nodes.find((node) => node.path === "shared.md")?.kind).toBe("both");
    expect(graph.nodes.find((node) => node.path === "missing.md")?.kind).toBe("broken");
    expect(graph.omitted).toBe(0);
  });

  it("現在文書を含め最大40ノードに制限し、完全応答なら省略数を返す", () => {
    const outgoing = Array.from({ length: 45 }, (_, index) =>
      edge("current.md", `document-${index.toString().padStart(2, "0")}.md`)
    );
    const graph = buildLinkGraph(current, section(outgoing), section([]), section([]));

    expect(graph.nodes).toHaveLength(40);
    expect(graph.omitted).toBe(6);
    expect(graph.nodes.map((node) => node.path)).toEqual(
      [...graph.nodes.map((node) => node.path)].sort((a, b) =>
        a === "current.md" ? -1 : b === "current.md" ? 1 : a.localeCompare(b)
      )
    );
  });

  it("不完全応答から省略ノード数を推測しない", () => {
    const graph = buildLinkGraph(current, section([], null), section([]), section([]));
    expect(graph.omitted).toBeNull();
  });
});
