import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openMarkdownFile, openSourceMarkdown } from "$lib/actions/file-actions";
import { registerZipSource } from "$lib/document-sources";
import { reopenRecentlyClosedTab } from "$lib/actions/tab-actions";
import { tabStore } from "$lib/stores/tab.svelte";
import type { DocumentSourceInfo, Tab } from "$lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("$lib/actions/file-actions", () => ({
  openMarkdownFile: vi.fn(),
  openSourceMarkdown: vi.fn(),
}));
vi.mock("$lib/document-sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/document-sources")>()),
  registerZipSource: vi.fn(),
}));

const capabilities = {
  watch: "entries" as const,
  externalEditor: true,
  respectGitignore: true,
  fullTextSearch: true,
  wikiLinks: true,
};

function nativeSource(): DocumentSourceInfo {
  return {
    id: "native",
    kind: "native",
    label: "notes",
    nativePath: "C:/notes",
    capabilities,
  };
}

function tab(id: string, path: string): Tab {
  return { id, path, title: path.split("/").pop() ?? path };
}

describe("reopenRecentlyClosedTab", () => {
  beforeEach(() => {
    for (const current of [...tabStore.tabs]) {
      if (current.pinned) tabStore.togglePin(current.id);
      tabStore.close(current.id);
    }
    tabStore.clearRecentlyClosed();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("通常の読み込み経路を使い、元の位置とソース表示モードを復元する", async () => {
    const source = nativeSource();
    tabStore.addOrActivate(tab("first", "first"));
    tabStore.addOrActivate({
      id: "closed",
      path: "native:guide%2Fclosed.md",
      title: "closed.md",
      document: { sourceId: source.id, path: "guide/closed.md" },
      source,
      viewMode: "source",
    });
    tabStore.addOrActivate(tab("last", "last"));
    await tabStore.closeAndUnwatch("closed");
    vi.mocked(openSourceMarkdown).mockImplementation(async (document, restoredSource) => {
      tabStore.addOrActivate({
        id: "restored",
        path: `${document.sourceId}:${document.path}`,
        title: "closed.md",
        document,
        source: restoredSource,
      });
      return true;
    });

    await expect(reopenRecentlyClosedTab()).resolves.toBe(true);
    expect(openSourceMarkdown).toHaveBeenCalledWith(
      { sourceId: "native", path: "guide/closed.md" },
      source
    );
    expect(tabStore.tabs.map((current) => current.id)).toEqual(["first", "restored", "last"]);
    expect(tabStore.tabs[1].viewMode).toBe("source");
  });

  it("解除済みZIPソースを再登録して新しいsource idへ差し替える", async () => {
    const source: DocumentSourceInfo = {
      ...nativeSource(),
      id: "old-zip",
      kind: "zip",
      nativePath: "C:/notes/archive.zip",
      capabilities: { ...capabilities, watch: "container", externalEditor: false },
    };
    const registered = { ...source, id: "new-zip" };
    vi.mocked(registerZipSource).mockResolvedValue(registered);
    vi.mocked(openSourceMarkdown).mockResolvedValue(true);
    tabStore.addOrActivate({
      id: "closed",
      path: "old-zip:README.md",
      title: "README.md",
      source,
      document: { sourceId: source.id, path: "README.md" },
    });
    await tabStore.closeAndUnwatch("closed");

    await expect(reopenRecentlyClosedTab()).resolves.toBe(true);
    expect(registerZipSource).toHaveBeenCalledWith("C:/notes/archive.zip");
    expect(openSourceMarkdown).toHaveBeenCalledWith(
      { sourceId: "new-zip", path: "README.md" },
      registered
    );
  });

  it("再読み込みに失敗した履歴を消費し、中途半端なタブを残さない", async () => {
    tabStore.addOrActivate(tab("closed", "C:/notes/missing.md"));
    await tabStore.closeAndUnwatch("closed");
    vi.mocked(openMarkdownFile).mockRejectedValue(new Error("missing"));

    await expect(reopenRecentlyClosedTab()).resolves.toBe(false);
    expect(tabStore.tabs).toEqual([]);
    expect(tabStore.canReopenClosedTab).toBe(false);
  });

  it("進行中のZIP解除を待ってから以前の履歴を再オープンする", async () => {
    tabStore.addOrActivate(tab("older", "C:/notes/older.md"));
    await tabStore.closeAndUnwatch("older");
    const source: DocumentSourceInfo = {
      ...nativeSource(),
      id: "zip",
      kind: "zip",
      nativePath: "C:/notes/archive.zip",
      capabilities: { ...capabilities, watch: "container", externalEditor: false },
    };
    tabStore.addOrActivate({
      id: "zip-tab",
      path: "zip:README.md",
      title: "README.md",
      source,
      document: { sourceId: source.id, path: "README.md" },
    });
    let finishUnwatch: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation((command) =>
      command === "unwatch_path"
        ? new Promise<void>((resolve) => (finishUnwatch = () => resolve()))
        : Promise.resolve(undefined)
    );
    const registered = { ...source, id: "zip-reopened" };
    vi.mocked(registerZipSource).mockResolvedValue(registered);
    vi.mocked(openSourceMarkdown).mockResolvedValue(true);

    const closing = tabStore.closeAndUnwatch("zip-tab");
    const reopening = reopenRecentlyClosedTab();
    await Promise.resolve();
    expect(openMarkdownFile).not.toHaveBeenCalled();

    finishUnwatch?.();
    await closing;
    await expect(reopening).resolves.toBe(true);
    expect(registerZipSource).toHaveBeenCalledWith("C:/notes/archive.zip");
    expect(openSourceMarkdown).toHaveBeenCalledWith(
      { sourceId: "zip-reopened", path: "README.md" },
      registered
    );
  });
});
