import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("$lib/actions/dialog-actions", () => ({
  openArchive: vi.fn(),
  openFolder: vi.fn(),
}));
vi.mock("$lib/actions/security", () => ({
  authorizeArchivePath: vi.fn(),
  authorizePath: vi.fn(),
}));
vi.mock("$lib/actions/file-actions", () => ({
  openMarkdownFile: vi.fn(),
  openSourceMarkdown: vi.fn(),
}));
vi.mock("$lib/actions/explorer-actions", () => ({
  restoreExpandedDirectories: vi.fn(),
  sanitizeExpandedDirectories: (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
}));

import { invoke } from "@tauri-apps/api/core";
import { openFolder } from "$lib/actions/dialog-actions";
import { authorizePath } from "$lib/actions/security";
import { openMarkdownFile } from "$lib/actions/file-actions";
import { restoreExpandedDirectories } from "$lib/actions/explorer-actions";
import {
  discardSavedTabs,
  flushTabs,
  restoredActiveTabId,
  restoreSavedTabs,
  saveAndFlushTabs,
  saveTabs,
} from "$lib/tabs-store";
import { tabStore } from "$lib/stores/tab.svelte";
import { explorerStore } from "$lib/stores/explorer.svelte";
import { searchStore } from "$lib/stores/search.svelte";
import { sessionUiStateStore } from "$lib/stores/session-ui-state.svelte";

const mockedInvoke = vi.mocked(invoke);
const mockedAuthorizePath = vi.mocked(authorizePath);
const mockedOpenMarkdownFile = vi.mocked(openMarkdownFile);
const mockedOpenFolder = vi.mocked(openFolder);

beforeEach(() => {
  vi.clearAllMocks();
  for (const tab of [...tabStore.tabs]) {
    if (tab.pinned) tabStore.togglePin(tab.id);
    tabStore.close(tab.id);
  }
  explorerStore.clear();
  sessionUiStateStore.clear();
  searchStore.restoreSessionState(null);
  mockedInvoke.mockResolvedValue(undefined);
});

describe("restoredActiveTabId", () => {
  it("先行タブの復元失敗後も保存時activeIndexに対応するタブを選ぶ", () => {
    const restored = new Map([
      [1, "tab-b"],
      [2, "tab-c"],
    ]);

    expect(restoredActiveTabId(restored, 1)).toBe("tab-b");
    expect(restoredActiveTabId(restored, 0)).toBeNull();
  });
});

describe("tabs session persistence", () => {
  it("スクロール・Explorer展開・検索を同じpayloadへ保存する", async () => {
    tabStore.addOrActivate({ id: "tab-a", path: "D:/notes/a.md", title: "a.md" });
    sessionUiStateStore.restoreScrollPositions("tab-a", { rendered: 320 });
    explorerStore.setRoot("D:/notes", [], undefined);
    explorerStore.expandDir("docs");
    searchStore.restoreSessionState({ open: true, query: "needle", useRegex: true });

    const saving = saveTabs();
    await flushTabs();
    await saving;

    expect(mockedInvoke).toHaveBeenCalledWith("save_app_state", {
      kind: "tabs",
      value: expect.objectContaining({
        expandedDirs: ["docs"],
        search: { open: true, query: "needle", useRegex: true },
        tabs: [expect.objectContaining({ scrollPositions: { rendered: 320 } })],
      }),
    });
  });

  it("復元したタブIDへスクロールを結び直し、Explorerと検索を復元する", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "load_app_state") {
        return {
          tabs: [
            {
              path: "D:/notes/a.md",
              pinned: false,
              scrollPositions: { rendered: 480 },
            },
          ],
          activeIndex: 0,
          expandedDirs: ["docs"],
          search: { open: true, query: "restored", useRegex: false },
        };
      }
      return undefined;
    });
    mockedAuthorizePath.mockResolvedValue(true);
    mockedOpenMarkdownFile.mockImplementation(async (path) => {
      tabStore.addOrActivate({ id: "new-tab-id", path, title: "a.md" });
      return true;
    });

    await restoreSavedTabs();

    expect(tabStore.activeTabId).toBe("new-tab-id");
    expect(sessionUiStateStore.getScroll("new-tab-id", "rendered")).toBe(480);
    expect(restoreExpandedDirectories).toHaveBeenCalledWith(["docs"]);
    expect(searchStore.sessionState).toEqual({
      open: true,
      query: "restored",
      useRegex: false,
    });
  });

  it("現行explorerフィールドからネイティブフォルダーを復元する", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "load_app_state") {
        return {
          tabs: [],
          activeIndex: null,
          explorer: { kind: "native", nativePath: "D:/notes" },
        };
      }
      return undefined;
    });
    mockedOpenFolder.mockResolvedValue(true);

    await restoreSavedTabs();

    expect(mockedOpenFolder).toHaveBeenCalledWith("D:/notes");
  });

  it("破棄時に追加UI状態も空の値で保存する", async () => {
    await discardSavedTabs();

    expect(mockedInvoke).toHaveBeenCalledWith("save_app_state", {
      kind: "tabs",
      value: {
        tabs: [],
        activeIndex: null,
        explorer: null,
        expandedDirs: [],
        search: { open: false, query: "", useRegex: false },
      },
    });
  });

  it("スクロール保存通知のデバウンス中でも終了用flushは最新位置を保存する", async () => {
    tabStore.addOrActivate({ id: "tab-a", path: "D:/notes/a.md", title: "a.md" });
    sessionUiStateStore.setScroll("tab-a", "rendered", 640);

    await saveAndFlushTabs();

    expect(mockedInvoke).toHaveBeenCalledWith("save_app_state", {
      kind: "tabs",
      value: expect.objectContaining({
        tabs: [expect.objectContaining({ scrollPositions: { rendered: 640 } })],
      }),
    });
  });
});
