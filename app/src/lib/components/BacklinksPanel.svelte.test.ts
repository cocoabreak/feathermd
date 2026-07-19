import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import BacklinksPanel from "$lib/components/BacklinksPanel.svelte";
import { backlinksStore } from "$lib/stores/backlinks.svelte";
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

describe("BacklinksPanel", () => {
  beforeEach(() => {
    for (const tab of [...tabStore.tabs]) {
      if (tab.pinned) tabStore.togglePin(tab.id);
      tabStore.close(tab.id);
    }
    backlinksStore.clear();
    if (!settingsStore.settings.renderers["wiki-links"]) {
      settingsStore.toggleRenderer("wiki-links");
    }
    vi.clearAllMocks();
  });

  it("アクティブ文書の参照元と参照数を表示して開く", async () => {
    invokeMock.mockResolvedValue({
      results: [
        {
          document: { sourceId: source.id, path: "guide/ref.md" },
          filePath: "guide/ref.md",
          referenceCount: 2,
        },
      ],
      truncated: false,
    });
    vi.mocked(openSourceMarkdown).mockResolvedValue(true);
    tabStore.addOrActivate({
      id: "current",
      path: "source-1:current.md",
      title: "current.md",
      source,
      document: { sourceId: source.id, path: "current.md" },
    });

    const view = render(BacklinksPanel);
    const result = await view.findByRole("button", { name: /ref\.md/ });
    expect(result).toHaveTextContent("2");
    await fireEvent.click(result);
    expect(openSourceMarkdown).toHaveBeenCalledWith(
      { sourceId: source.id, path: "guide/ref.md" },
      source
    );
  });

  it("再読み込みボタンで強制更新する", async () => {
    invokeMock.mockResolvedValue({ results: [], truncated: false });
    tabStore.addOrActivate({
      id: "current",
      path: "source-1:current.md",
      title: "current.md",
      source,
      document: { sourceId: source.id, path: "current.md" },
    });
    const view = render(BacklinksPanel);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    await fireEvent.click(view.getByRole("button", { name: "Refresh backlinks" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock.mock.calls[1]?.[1]).toMatchObject({ forceRefresh: true });
  });
});
