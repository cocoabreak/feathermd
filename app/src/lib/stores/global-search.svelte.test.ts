import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import { explorerStore } from "./explorer.svelte";
import { GlobalSearchStore, type SearchResult } from "./global-search.svelte";
import type { DocumentSourceInfo } from "$lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("$lib/actions/file-actions", () => ({ openSourceMarkdown: vi.fn() }));

function source(id: string): DocumentSourceInfo {
  return {
    id,
    kind: "native",
    label: id,
    nativePath: `C:/${id}`,
    capabilities: {
      watch: "entries",
      externalEditor: true,
      respectGitignore: true,
      fullTextSearch: true,
      wikiLinks: true,
    },
  };
}

function result(sourceId: string): SearchResult {
  return {
    filePath: "note.md",
    document: { sourceId, path: "note.md" },
    matches: [{ line_number: 1, line_text: "needle" }],
  };
}

describe("GlobalSearchStore", () => {
  beforeEach(() => {
    explorerStore.clear();
    vi.clearAllMocks();
  });

  it("検索中にExplorerソースを切り替えると古い応答を破棄する", async () => {
    const store = new GlobalSearchStore();
    const first = source("source-a");
    explorerStore.setRoot(first.nativePath, [], first);
    store.query = "needle";
    let resolveSearch!: (value: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }) as never
    );

    const pending = store.search();
    const second = source("source-b");
    explorerStore.setRoot(second.nativePath, [], second);
    store.syncSource(second);
    resolveSearch({ results: [result(first.id)], truncated: false, cancelled: false });
    await pending;

    expect(store.results).toEqual([]);
    expect(store.isSearching).toBe(false);
  });

  it("現在のExplorerと異なるソースの結果は開かずページ内検索も開始しない", async () => {
    const store = new GlobalSearchStore();
    const current = source("source-b");
    explorerStore.setRoot(current.nativePath, [], current);
    store.syncSource(current);
    store.query = "needle";

    await expect(store.openMatch(result("source-a"), 1)).resolves.toBe(false);
    expect(openSourceMarkdown).not.toHaveBeenCalled();
  });

  it("同じSource IDでもgenerationが変わると古い結果を消す", () => {
    const store = new GlobalSearchStore();
    const current = { ...source("source-a"), generation: 1 };
    store.syncSource(current);
    store.results = [result(current.id)];

    store.syncSource({ ...current, generation: 2 });

    expect(store.results).toEqual([]);
  });
});
