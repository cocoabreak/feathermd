import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuickOpen from "./QuickOpen.svelte";
import { explorerStore } from "$lib/stores/explorer.svelte";
import { pickerStore } from "$lib/stores/picker.svelte";
import { i18n } from "$lib/i18n/index.svelte";
import type { DocumentSourceInfo } from "$lib/types";

const { invokeMock, openSourceMarkdownMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openSourceMarkdownMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("$lib/actions/file-actions", () => ({ openSourceMarkdown: openSourceMarkdownMock }));

const source: DocumentSourceInfo = {
  id: "source-quick-open",
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

beforeEach(() => {
  i18n.setLocale("ja");
  pickerStore.openQuickOpen();
  explorerStore.setRoot(source.nativePath, [], source);
  invokeMock.mockReset();
  openSourceMarkdownMock.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  explorerStore.clear();
  pickerStore.close();
});

describe("QuickOpen", () => {
  it("lists the current source and opens a selected document through the existing action", async () => {
    invokeMock.mockResolvedValue([
      { sourceId: source.id, path: "docs/Guide.md" },
      { sourceId: source.id, path: "README.md" },
    ]);
    render(QuickOpen);

    expect(await screen.findByText("Guide.md")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("list_source_markdown_documents", {
      sourceId: source.id,
      showHiddenFiles: false,
      respectGitignore: true,
    });

    await fireEvent.click(screen.getByText("Guide.md"));

    await waitFor(() =>
      expect(openSourceMarkdownMock).toHaveBeenCalledWith(
        { sourceId: source.id, path: "docs/Guide.md" },
        source
      )
    );
    expect(pickerStore.mode).toBeNull();
  });

  it("explains that an Explorer source is required", () => {
    explorerStore.clear();
    render(QuickOpen);
    expect(screen.getByText("先にフォルダーまたはアーカイブを開いてください")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
