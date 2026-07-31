import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import LinkInspectorPanel from "$lib/components/LinkInspectorPanel.svelte";
import { linkInspectorStore } from "$lib/stores/links.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import { tabStore } from "$lib/stores/tab.svelte";
import type { DocumentSourceInfo } from "$lib/types";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("$lib/actions/file-actions", () => ({ openSourceMarkdown: vi.fn() }));

const source: DocumentSourceInfo = {
  id: "source-1",
  kind: "native",
  label: "notes",
  nativePath: "D:/notes",
  generation: 0,
  capabilities: {
    watch: "entries",
    externalEditor: true,
    respectGitignore: true,
    fullTextSearch: true,
    wikiLinks: true,
  },
};
const current = { sourceId: source.id, path: "current.md" };

describe("LinkInspectorPanel", () => {
  beforeEach(() => {
    for (const tab of [...tabStore.tabs]) {
      if (tab.pinned) tabStore.togglePin(tab.id);
      tabStore.close(tab.id);
    }
    linkInspectorStore.clear();
    if (!settingsStore.settings.renderers["wiki-links"]) {
      settingsStore.toggleRenderer("wiki-links");
    }
    vi.clearAllMocks();
  });

  it("出力・問題を切り替え、解決済み文書とグラフを開く", async () => {
    const linkResponse = {
      outgoing: {
        items: [
          {
            source: current,
            target: { sourceId: source.id, path: "guide/target.md" },
            rawTarget: null,
            anchor: "Intro",
            kind: "markdown",
            referenceCount: 2,
          },
          {
            source: current,
            target: null,
            rawTarget: "missing.md",
            anchor: null,
            kind: "wiki",
            referenceCount: 1,
          },
        ],
        total: 2,
      },
      incoming: {
        items: [
          {
            source: { sourceId: source.id, path: "guide/referrer.md" },
            target: current,
            rawTarget: null,
            anchor: null,
            kind: "wiki",
            referenceCount: 1,
          },
        ],
        total: 1,
      },
      broken: {
        items: [
          {
            source: current,
            target: null,
            rawTarget: "missing.md",
            anchor: null,
            kind: "wiki",
            referenceCount: 1,
          },
        ],
        total: 1,
      },
      truncated: false,
    };
    let graphError = false;
    invokeMock.mockImplementation((command) => {
      if (command === "get_source_link_context") return Promise.resolve(linkResponse);
      if (command === "get_source_reference_validation") {
        return Promise.resolve({
          imageProblems: [
            {
              kind: "image",
              rawTarget: "images/missing.png",
              status: "missing",
              referenceCount: 1,
            },
          ],
          headingReferences: [],
          headingDocuments: [],
          truncated: false,
        });
      }
      return graphError ? Promise.reject("window error") : Promise.resolve(undefined);
    });
    vi.mocked(openSourceMarkdown).mockResolvedValue(true);
    tabStore.addOrActivate({
      id: "current",
      path: "source-1:current.md",
      title: "current.md",
      source,
      document: current,
    });

    const view = render(LinkInspectorPanel);
    const target = await view.findByRole("button", { name: /target\.md/ });
    expect(target).toHaveTextContent("#Intro");
    expect(target).toHaveTextContent("2");
    await fireEvent.click(target);
    expect(openSourceMarkdown).toHaveBeenCalledWith(
      { sourceId: source.id, path: "guide/target.md" },
      source
    );

    await fireEvent.click(view.getByRole("tab", { name: /Incoming/ }));
    await fireEvent.click(view.getByRole("button", { name: /referrer\.md/ }));
    expect(openSourceMarkdown).toHaveBeenLastCalledWith(
      { sourceId: source.id, path: "guide/referrer.md" },
      source
    );

    await fireEvent.click(view.getByRole("tab", { name: /Problems/ }));
    expect(view.getByTitle("missing.md")).toHaveAttribute("type", "button");
    expect(view.getByTitle("images/missing.png")).toHaveTextContent("Image");

    await fireEvent.click(view.getByRole("button", { name: "Show local link graph" }));
    expect(invokeMock).toHaveBeenCalledWith("open_link_graph_window");

    graphError = true;
    await fireEvent.click(view.getByRole("button", { name: "Show local link graph" }));
    expect(await view.findByRole("alert")).toHaveTextContent(
      "Could not open the link graph: window error"
    );
  });

  it("問題の空表示と件数不明の省略表示を示す", async () => {
    invokeMock.mockImplementation((command) => {
      if (command === "get_source_link_context") {
        return Promise.resolve({
          outgoing: { items: [], total: 0 },
          incoming: { items: [], total: 0 },
          broken: { items: [], total: null },
          truncated: false,
        });
      }
      return Promise.resolve({
        imageProblems: [],
        headingReferences: [],
        headingDocuments: [],
        truncated: false,
      });
    });
    tabStore.addOrActivate({
      id: "current",
      path: "source-1:current.md",
      title: "current.md",
      source,
      document: current,
    });

    const view = render(LinkInspectorPanel);
    await fireEvent.click(await view.findByRole("tab", { name: /Problems/ }));

    expect(view.getByText("No reference problems")).toBeInTheDocument();
    expect(
      view.getByText("Only some links are shown because the processing limit was reached")
    ).toBeInTheDocument();
  });

  it("検証失敗を表示する", async () => {
    invokeMock.mockImplementation((command) =>
      command === "get_source_link_context"
        ? Promise.resolve({
            outgoing: { items: [], total: 0 },
            incoming: { items: [], total: 0 },
            broken: { items: [], total: 0 },
            truncated: false,
          })
        : Promise.reject("validation failure")
    );
    tabStore.addOrActivate({
      id: "current",
      path: "source-1:current.md",
      title: "current.md",
      source,
      document: current,
    });

    const view = render(LinkInspectorPanel);

    expect(await view.findByText(/validation failure/)).toBeInTheDocument();
  });
});
