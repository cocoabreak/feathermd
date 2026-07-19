import { beforeEach, describe, expect, it, vi } from "vitest";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import { BacklinksStore } from "$lib/stores/backlinks.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import type { DocumentRef, DocumentSourceInfo } from "$lib/types";

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
const current: DocumentRef = { sourceId: source.id, path: "current.md" };

describe("BacklinksStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (settingsStore.settings.showHiddenFiles) settingsStore.toggleHiddenFiles();
    if (!settingsStore.settings.respectGitignore) settingsStore.toggleRespectGitignore();
  });

  it("現在文書のバックリンクを設定付きで遅延取得する", async () => {
    const store = new BacklinksStore();
    invokeMock.mockResolvedValue({
      results: [
        {
          document: { sourceId: source.id, path: "ref.md" },
          filePath: "ref.md",
          referenceCount: 2,
        },
      ],
      truncated: true,
    });

    await store.load(current, source);

    expect(invokeMock).toHaveBeenCalledWith("list_source_backlinks", {
      document: current,
      showHiddenFiles: false,
      respectGitignore: true,
      forceRefresh: false,
    });
    expect(store.results[0]).toMatchObject({ filePath: "ref.md", referenceCount: 2 });
    expect(store.truncated).toBe(true);
  });

  it("invalidate後は同じ文書でもキャッシュを強制更新する", async () => {
    const store = new BacklinksStore();
    invokeMock.mockResolvedValue({ results: [], truncated: false });
    await store.load(current, source);
    store.invalidate();
    await store.load(current, source);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[1]?.[1]).toMatchObject({ forceRefresh: true });
  });

  it("文書切替前の古い応答を破棄する", async () => {
    const store = new BacklinksStore();
    let finishFirst: ((value: unknown) => void) | undefined;
    invokeMock
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce({
        results: [
          {
            document: { sourceId: source.id, path: "new-ref.md" },
            filePath: "new-ref.md",
            referenceCount: 1,
          },
        ],
        truncated: false,
      });

    const first = store.load(current, source);
    const second = store.load({ ...current, path: "next.md" }, source);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    finishFirst?.({
      results: [
        {
          document: { sourceId: source.id, path: "old-ref.md" },
          filePath: "old-ref.md",
          referenceCount: 1,
        },
      ],
      truncated: false,
    });
    await Promise.all([first, second]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(store.results.map((result) => result.filePath)).toEqual(["new-ref.md"]);
  });

  it("同じSourceの参照元だけを既存読込経路で開く", async () => {
    const store = new BacklinksStore();
    const result = {
      document: { sourceId: source.id, path: "ref.md" },
      filePath: "ref.md",
      referenceCount: 1,
    };
    vi.mocked(openSourceMarkdown).mockResolvedValue(true);

    await expect(store.open(result, source)).resolves.toBe(true);
    expect(openSourceMarkdown).toHaveBeenCalledWith(result.document, source);
    await expect(
      store.open({ ...result, document: { sourceId: "other", path: "ref.md" } }, source)
    ).resolves.toBe(false);
  });
});
