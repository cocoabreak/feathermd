import { beforeEach, describe, expect, it, vi } from "vitest";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import { buildReferenceProblems, LinkInspectorStore } from "$lib/stores/links.svelte";
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
const emptyValidation = {
  imageProblems: [],
  headingReferences: [],
  headingDocuments: [],
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
    invokeMock.mockImplementation((command) =>
      Promise.resolve(command === "get_source_link_context" ? emptyResponse : emptyValidation)
    );
    await store.load(current, source);

    expect(invokeMock).toHaveBeenCalledWith("get_source_link_context", {
      document: current,
      showHiddenFiles: false,
      respectGitignore: true,
      includeWikiLinks: settingsStore.settings.renderers["wiki-links"] === true,
      forceRefresh: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("get_source_reference_validation", {
      document: current,
      respectGitignore: true,
      includeWikiLinks: settingsStore.settings.renderers["wiki-links"] === true,
    });
  });

  it("invalidate後は強制更新し、解決済み文書だけを既存経路で開く", async () => {
    const store = new LinkInspectorStore();
    invokeMock.mockImplementation((command) =>
      Promise.resolve(command === "get_source_link_context" ? emptyResponse : emptyValidation)
    );
    await store.load(current, source);
    store.invalidate();
    await store.load(current, source);
    expect(invokeMock.mock.calls[2]?.[1]).toMatchObject({ forceRefresh: true });

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
    invokeMock.mockImplementation((command, args) => {
      if (command === "get_source_reference_validation") return Promise.resolve(emptyValidation);
      if (args.document.path === "current.md" && !finishFirst) {
        return new Promise((resolve) => (finishFirst = resolve));
      }
      return Promise.resolve({
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

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(store.outgoing.items[0]?.target?.path).toBe("new.md");
  });

  it.each([
    ["get_source_link_context", "link failure"],
    ["get_source_reference_validation", "validation failure"],
  ])("%sの失敗時は部分結果を確定しない", async (failedCommand, message) => {
    const store = new LinkInspectorStore();
    invokeMock.mockImplementation((command) => {
      if (command === failedCommand) return Promise.reject(message);
      return Promise.resolve(
        command === "get_source_link_context" ? emptyResponse : emptyValidation
      );
    });

    await store.load(current, source);

    expect(store.error).toContain(message);
    expect(store.outgoing).toEqual(emptyResponse.outgoing);
    expect(store.problems).toEqual({ items: [], total: 0 });
    expect(store.isLoading).toBe(false);
  });

  it("文書・画像・見出しの問題を共通モデルへ変換する", () => {
    const problems = buildReferenceProblems(
      {
        items: [
          {
            source: current,
            target: null,
            rawTarget: "missing.md",
            anchor: null,
            kind: "markdown",
            referenceCount: 2,
          },
        ],
        total: 1,
      },
      {
        imageProblems: [
          {
            kind: "image",
            rawTarget: "images/missing.png",
            status: "missing",
            referenceCount: 1,
          },
        ],
        headingReferences: [
          {
            document: current,
            rawTarget: "",
            anchor: "win",
            kind: "markdown",
            referenceCount: 1,
          },
          {
            document: current,
            rawTarget: "",
            anchor: "same-1",
            kind: "wiki",
            referenceCount: 1,
          },
          {
            document: current,
            rawTarget: "",
            anchor: "Win :trophy:",
            kind: "markdown",
            referenceCount: 1,
          },
          {
            document: current,
            rawTarget: "",
            anchor: "%E4%B8%8D%E5%AD%98%E5%9C%A8",
            kind: "markdown",
            referenceCount: 1,
          },
          {
            document: { ...current, path: "unreadable.md" },
            rawTarget: "unreadable.md",
            anchor: "heading",
            kind: "markdown",
            referenceCount: 1,
          },
        ],
        headingDocuments: [
          {
            document: current,
            complete: true,
            headings: [
              {
                level: 1,
                text: "Win :trophy:",
                anchorText: "Win :trophy:",
                id: "safe-heading-0",
                utf16Offset: 0,
              },
              {
                level: 2,
                text: "Same",
                anchorText: "Same",
                id: "safe-heading-1",
                utf16Offset: 10,
              },
              {
                level: 2,
                text: "Same",
                anchorText: "Same",
                id: "safe-heading-2",
                utf16Offset: 20,
              },
            ],
          },
          {
            document: { ...current, path: "unreadable.md" },
            complete: false,
            headings: [],
          },
        ],
        truncated: false,
      }
    );

    expect(problems.items.map((problem) => [problem.kind, problem.status])).toEqual([
      ["document", "missing"],
      ["heading", "missing"],
      ["heading", "unverifiable"],
      ["image", "missing"],
    ]);
    expect(problems.total).toBe(4);
  });
});
