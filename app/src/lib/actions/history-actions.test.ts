import { describe, expect, it, vi } from "vitest";
import { navigateHistory } from "$lib/actions/history-actions";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import { registerZipSource, rememberDocument } from "$lib/document-sources";
import { historyStore } from "$lib/stores/history.svelte";

vi.mock("$lib/actions/file-actions", () => ({
  openMarkdownFile: vi.fn(),
  openSourceMarkdown: vi.fn(),
}));

vi.mock("$lib/document-sources", () => ({
  documentKey: (document: { sourceId: string; path: string }) =>
    `${document.sourceId}:${document.path}`,
  getRememberedDocument: (key: string) =>
    key === "source-old:README.md"
      ? {
          document: { sourceId: "source-old", path: "README.md" },
          source: {
            id: "source-old",
            kind: "zip",
            label: "notes.zip",
            nativePath: "C:/archives/notes.zip",
            capabilities: {
              watch: "container",
              externalEditor: false,
              respectGitignore: false,
              fullTextSearch: true,
              wikiLinks: true,
            },
          },
        }
      : undefined,
  registerZipSource: vi.fn(),
  rememberDocument: vi.fn(),
}));

describe("navigateHistory", () => {
  it("解除済みZIPソースを再登録し、現在の履歴キーを新しいSource IDへ更新する", async () => {
    historyStore.record("source-old:README.md");
    historyStore.record("native:current.md");
    vi.mocked(openSourceMarkdown)
      .mockRejectedValueOnce(new Error("source not found"))
      .mockResolvedValueOnce(true);
    vi.mocked(registerZipSource).mockResolvedValue({
      id: "source-new",
      kind: "zip",
      label: "notes.zip",
      nativePath: "C:/archives/notes.zip",
      capabilities: {
        watch: "container",
        externalEditor: false,
        respectGitignore: false,
        fullTextSearch: true,
        wikiLinks: true,
      },
    });

    await navigateHistory(-1);

    expect(registerZipSource).toHaveBeenCalledWith("C:/archives/notes.zip");
    expect(rememberDocument).toHaveBeenCalledWith(
      { sourceId: "source-new", path: "README.md" },
      expect.objectContaining({ id: "source-new" })
    );
    expect(historyStore.entries[historyStore.index]).toBe("source-new:README.md");
    expect(openSourceMarkdown).toHaveBeenLastCalledWith(
      { sourceId: "source-new", path: "README.md" },
      expect.objectContaining({ id: "source-new" })
    );
  });
});
