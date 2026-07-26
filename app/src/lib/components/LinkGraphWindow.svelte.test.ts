import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LinkGraphWindow from "$lib/components/LinkGraphWindow.svelte";
import { i18n } from "$lib/i18n/index.svelte";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("LinkGraphWindow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    i18n.setLocale("en");
  });

  it("Rust側の現在文書を読み込み、ノード選択を安全なコマンドで返す", async () => {
    const current = { sourceId: "source-1", path: "index.md" };
    const target = { sourceId: "source-1", path: "guide/target.md" };
    const context = {
      document: current,
      revision: 0,
      showHiddenFiles: false,
      respectGitignore: true,
      includeWikiLinks: true,
      locale: "en",
      dark: false,
    } as const;
    const response = {
      outgoing: {
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
      },
      incoming: { items: [], total: 0 },
      broken: { items: [], total: 0 },
      truncated: false,
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_link_graph_window_context") {
        return Promise.resolve({ contextVersion: 7, context });
      }
      if (command === "get_link_graph_data") return Promise.resolve(response);
      return Promise.resolve(undefined);
    });
    const view = render(LinkGraphWindow);

    const graph = await view.findByRole("application", { name: "Local link graph" });
    expect(invokeMock).toHaveBeenCalledWith("get_link_graph_data", {
      contextVersion: 7,
      forceRefresh: false,
    });

    await fireEvent.focus(graph);
    await fireEvent.keyDown(graph, { key: "ArrowRight" });
    await fireEvent.keyDown(graph, { key: "Enter" });
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("request_link_graph_document_open", {
        contextVersion: 7,
        origin: current,
        target,
      })
    );
    view.unmount();
  });
});
