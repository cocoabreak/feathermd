import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  MAX_RESTORED_DIRECTORY_ENTRIES,
  MAX_RESTORED_EXPANDED_DIRS,
  restoreExpandedDirectories,
  sanitizeExpandedDirectories,
  syncDirWatches,
} from "./explorer-actions";
import { explorerStore } from "$lib/stores/explorer.svelte";
import * as documentSources from "$lib/document-sources";
import type { DocumentSourceInfo, FileEntry } from "$lib/types";

const source: DocumentSourceInfo = {
  id: "source",
  kind: "native",
  label: "notes",
  nativePath: "D:/notes",
  capabilities: {
    watch: "none",
    externalEditor: true,
    respectGitignore: true,
    fullTextSearch: true,
    wikiLinks: true,
  },
};
const watchableSource: DocumentSourceInfo = {
  ...source,
  capabilities: { ...source.capabilities, watch: "entries" },
};
const mockedInvoke = vi.mocked(invoke);

function dir(path: string): FileEntry {
  return {
    name: path.split("/").at(-1) ?? path,
    path,
    document: { sourceId: source.id, path },
    isDir: true,
    isHidden: false,
  };
}

describe("sanitizeExpandedDirectories", () => {
  it("文字列だけを重複排除する", () => {
    expect(sanitizeExpandedDirectories(["a", 1, "a", null, "b"])).toEqual(["a", "b"]);
  });

  it("復元件数を上限内に制限する", () => {
    const paths = Array.from(
      { length: MAX_RESTORED_EXPANDED_DIRS + 10 },
      (_, index) => `dir-${index}`
    );
    expect(sanitizeExpandedDirectories(paths)).toHaveLength(MAX_RESTORED_EXPANDED_DIRS);
  });

  it("配列以外は空として扱う", () => {
    expect(sanitizeExpandedDirectories("dir")).toEqual([]);
  });
});

describe("restoreExpandedDirectories", () => {
  beforeEach(() => {
    explorerStore.clear();
    explorerStore.setRoot("D:/notes", [dir("a")], source);
    vi.restoreAllMocks();
    mockedInvoke.mockResolvedValue(undefined);
  });

  it("保存順に依存せず親から子を読み込んで展開する", async () => {
    vi.spyOn(documentSources, "listSourceEntries").mockImplementation(async (document) =>
      document.path === "a" ? [dir("a/b")] : []
    );

    await restoreExpandedDirectories(["a/b", "a"]);

    expect(explorerStore.expandedDirs).toEqual(new Set(["a", "a/b"]));
    expect(documentSources.listSourceEntries).toHaveBeenCalledTimes(2);
  });

  it("欠損パスと読み込み失敗を展開せずにスキップする", async () => {
    vi.spyOn(documentSources, "listSourceEntries").mockRejectedValue(new Error("unreadable"));

    await restoreExpandedDirectories(["missing", "a"]);

    expect(explorerStore.expandedDirs).toEqual(new Set());
  });

  it("累積エントリ予算を超えるディレクトリ以降を復元しない", async () => {
    explorerStore.setRoot("D:/notes", [dir("a"), dir("b")], source);
    vi.spyOn(documentSources, "listSourceEntries").mockImplementation(async (document) => {
      if (document.path === "a") {
        return Array.from({ length: MAX_RESTORED_DIRECTORY_ENTRIES + 1 }, (_, index) => ({
          ...dir(`a/${index}`),
          isDir: false,
        }));
      }
      return [];
    });

    await restoreExpandedDirectories(["a", "b"]);

    expect(explorerStore.expandedDirs).toEqual(new Set());
    expect(documentSources.listSourceEntries).toHaveBeenCalledTimes(1);
  });
});

describe("syncDirWatches", () => {
  beforeEach(async () => {
    explorerStore.clear();
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
    await syncDirWatches();
    mockedInvoke.mockClear();
  });

  it("表示中の監視集合をRustへ一括送信する", async () => {
    explorerStore.setRoot("D:/notes", [], watchableSource);

    await syncDirWatches();

    expect(mockedInvoke).toHaveBeenCalledWith("reconcile_directory_watches", {
      paths: ["D:/notes"],
    });
  });

  it("同期中に状態が変わっても最後の集合へ収束する", async () => {
    let releaseFirst: (() => void) | undefined;
    mockedInvoke.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFirst = resolve))
    );
    explorerStore.setRoot("D:/notes", [], watchableSource);
    const first = syncDirWatches();
    await vi.waitFor(() => expect(mockedInvoke).toHaveBeenCalledTimes(1));

    explorerStore.clear();
    const latest = syncDirWatches();
    releaseFirst?.();
    await Promise.all([first, latest]);

    expect(mockedInvoke.mock.calls).toEqual([
      ["reconcile_directory_watches", { paths: ["D:/notes"] }],
      ["reconcile_directory_watches", { paths: [] }],
    ]);
  });
});
