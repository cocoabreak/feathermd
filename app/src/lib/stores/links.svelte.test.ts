import { beforeEach, describe, expect, it, vi } from "vitest";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import { LinkInspectorStore } from "$lib/stores/links.svelte";
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
const emptyResponse = {
  outgoing: { items: [], total: 0 },
  incoming: { items: [], total: 0 },
  broken: { items: [], total: 0 },
  truncated: false,
};

describe("LinkInspectorStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (settingsStore.settings.showHiddenFiles) settingsStore.toggleHiddenFiles();
    if (!settingsStore.settings.respectGitignore) settingsStore.toggleRespectGitignore();
  });

  it("Wiki設定を含む共通リンク文脈を遅延取得する", async () => {
    const store = new LinkInspectorStore();
    invokeMock.mockResolvedValue(emptyResponse);
    await store.load(current, source);

    expect(invokeMock).toHaveBeenCalledWith("get_source_link_context", {
      document: current,
      showHiddenFiles: false,
      respectGitignore: true,
      includeWikiLinks: settingsStore.settings.renderers["wiki-links"] === true,
      forceRefresh: false,
    });
  });

  it("invalidate後は強制更新し、解決済み文書だけを既存経路で開く", async () => {
    const store = new LinkInspectorStore();
    invokeMock.mockResolvedValue(emptyResponse);
    await store.load(current, source);
    store.invalidate();
    await store.load(current, source);
    expect(invokeMock.mock.calls[1]?.[1]).toMatchObject({ forceRefresh: true });

    const resolved = {
      source: current,
      target: { sourceId: source.id, path: "target.md" },
      rawTarget: null,
      anchor: null,
      kind: "markdown" as const,
      referenceCount: 1,
    };
    vi.mocked(openSourceMarkdown).mockResolvedValue(true);
    await expect(store.openDocument(resolved.target, source)).resolves.toBe(true);
    await expect(store.openDocument(null, source)).resolves.toBe(false);
    expect(openSourceMarkdown).toHaveBeenCalledOnce();
  });

  it("文書切替前の古い応答を破棄する", async () => {
    const store = new LinkInspectorStore();
    let finishFirst: ((value: unknown) => void) | undefined;
    invokeMock
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce({
        ...emptyResponse,
        outgoing: {
          items: [
            {
              source: { ...current, path: "next.md" },
              target: { sourceId: source.id, path: "new.md" },
              rawTarget: null,
              anchor: null,
              kind: "markdown",
              referenceCount: 1,
            },
          ],
          total: 1,
        },
      });

    const first = store.load(current, source);
    const second = store.load({ ...current, path: "next.md" }, source);
    finishFirst?.({
      ...emptyResponse,
      outgoing: {
        items: [
          {
            source: current,
            target: { sourceId: source.id, path: "old.md" },
            rawTarget: null,
            anchor: null,
            kind: "markdown",
            referenceCount: 1,
          },
        ],
        total: 1,
      },
    });
    await Promise.all([first, second]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(store.outgoing.items[0]?.target?.path).toBe("new.md");
  });
});
