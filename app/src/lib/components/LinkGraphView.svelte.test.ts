import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import LinkGraphView from "$lib/components/LinkGraphView.svelte";
import type { LinkContextSection } from "$lib/stores/links.svelte";

const EMPTY_SECTION: LinkContextSection = { items: [], total: 0 };

describe("LinkGraphView", () => {
  it("キーボードで隣の解決済みノードを選択して開く", async () => {
    const current = { sourceId: "source-1", path: "index.md" };
    const target = { sourceId: "source-1", path: "guide/target.md" };
    const outgoing: LinkContextSection = {
      items: [
        {
          source: current,
          target,
          rawTarget: null,
          anchor: null,
          kind: "markdown",
          referenceCount: 1,
        },
      ],
      total: 1,
    };
    const onopen = vi.fn();
    const view = render(LinkGraphView, {
      props: {
        current,
        outgoing,
        incoming: EMPTY_SECTION,
        broken: EMPTY_SECTION,
        onopen,
      },
    });

    const graph = view.getByRole("application", { name: "Local link graph" });
    await fireEvent.focus(graph);
    await fireEvent.keyDown(graph, { key: "ArrowRight" });
    await fireEvent.keyDown(graph, { key: "Enter" });

    expect(onopen).toHaveBeenCalledWith(expect.objectContaining({ document: target }));
  });
});
