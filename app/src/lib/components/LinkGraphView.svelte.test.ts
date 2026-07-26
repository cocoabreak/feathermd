import { fireEvent, render, waitFor } from "@testing-library/svelte";
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
    const onpreview = vi.fn();
    const view = render(LinkGraphView, {
      props: {
        current,
        outgoing,
        incoming: EMPTY_SECTION,
        broken: EMPTY_SECTION,
        onopen,
        onpreview,
        onpreviewleave: vi.fn(),
      },
    });

    const graph = view.getByRole("application", { name: "Local link graph" });
    await fireEvent.focus(graph);
    expect(onpreview).toHaveBeenCalledWith(
      expect.objectContaining({ document: current }),
      expect.any(Function),
      true
    );
    await fireEvent.keyDown(graph, { key: "ArrowRight" });
    expect(onpreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ document: target }),
      expect.any(Function),
      true
    );
    await fireEvent.keyDown(graph, { key: "Enter" });

    expect(onopen).toHaveBeenCalledWith(expect.objectContaining({ document: target }));
  });

  it("選択中のノードが更新で消えたらプレビューを閉じる", async () => {
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
    const onpreviewleave = vi.fn();
    const props = {
      current,
      outgoing,
      incoming: EMPTY_SECTION,
      broken: EMPTY_SECTION,
      onopen: vi.fn(),
      onpreview: vi.fn(),
      onpreviewleave,
    };
    const view = render(LinkGraphView, { props });
    const graph = view.getByRole("application", { name: "Local link graph" });
    await fireEvent.focus(graph);
    await fireEvent.keyDown(graph, { key: "ArrowRight" });
    onpreviewleave.mockClear();

    await view.rerender({ ...props, outgoing: EMPTY_SECTION });

    await waitFor(() => expect(onpreviewleave).toHaveBeenCalled());
  });
});
