import { invoke } from "@tauri-apps/api/core";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tabStore } from "./tab.svelte";
import type { DocumentSourceInfo, Tab } from "$lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function makeTab(id: string, path: string): Tab {
  return { id, path, title: path.split("/").pop() ?? path };
}

describe("tabStore", () => {
  beforeEach(() => {
    for (const tab of [...tabStore.tabs]) {
      if (tab.pinned) tabStore.togglePin(tab.id);
      tabStore.close(tab.id);
    }
    tabStore.clearRecentlyClosed();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("addOrActivate はタブがなければ追加してアクティブにする", () => {
    tabStore.addOrActivate(makeTab("1", "/a.md"));
    expect(tabStore.tabs.map((t) => t.id)).toEqual(["1"]);
    expect(tabStore.activeTabId).toBe("1");
  });

  it("addOrActivate は同一パスのタブが既にあれば追加せず既存タブをアクティブにする", () => {
    tabStore.addOrActivate(makeTab("1", "/a.md"));
    tabStore.addOrActivate(makeTab("2", "/b.md"));
    tabStore.addOrActivate({ id: "3", path: "/a.md", title: "a.md" });

    expect(tabStore.tabs.map((t) => t.id)).toEqual(["1", "2"]);
    expect(tabStore.activeTabId).toBe("1");
  });

  it("close はアクティブでないタブを閉じてもアクティブタブを変更しない", () => {
    tabStore.addOrActivate(makeTab("1", "/a.md"));
    tabStore.addOrActivate(makeTab("2", "/b.md"));
    tabStore.setActive("1");

    tabStore.close("2");

    expect(tabStore.tabs.map((t) => t.id)).toEqual(["1"]);
    expect(tabStore.activeTabId).toBe("1");
  });

  it("close はアクティブタブを閉じると隣接タブへ再割当する", () => {
    tabStore.addOrActivate(makeTab("1", "/a.md"));
    tabStore.addOrActivate(makeTab("2", "/b.md"));
    tabStore.addOrActivate(makeTab("3", "/c.md"));
    tabStore.setActive("2");

    tabStore.close("2");

    expect(tabStore.tabs.map((t) => t.id)).toEqual(["1", "3"]);
    expect(tabStore.activeTabId).toBe("3");
  });

  it("close で最後のタブを閉じると activeTabId は null になる", () => {
    tabStore.addOrActivate(makeTab("1", "/a.md"));

    tabStore.close("1");

    expect(tabStore.tabs).toEqual([]);
    expect(tabStore.activeTabId).toBeNull();
  });

  it("updateTab は指定タブのプロパティを部分的にマージする", () => {
    tabStore.addOrActivate(makeTab("1", "/a.md"));

    tabStore.updateTab("1", { status: "deleted" });

    expect(tabStore.tabs[0]).toMatchObject({ id: "1", path: "/a.md", status: "deleted" });
  });

  it("ピン留めタブを先頭グループへ移動し、解除時は通常グループの先頭へ戻す", () => {
    tabStore.addOrActivate(makeTab("1", "/a.md"));
    tabStore.addOrActivate(makeTab("2", "/b.md"));
    tabStore.addOrActivate(makeTab("3", "/c.md"));

    tabStore.togglePin("2");
    tabStore.togglePin("3");
    expect(tabStore.tabs.map((tab) => tab.id)).toEqual(["2", "3", "1"]);

    tabStore.togglePin("2");
    expect(tabStore.tabs.map((tab) => tab.id)).toEqual(["3", "2", "1"]);
  });

  it("moveRelative は同じピン留めグループ内だけを並べ替える", () => {
    tabStore.addOrActivate({ ...makeTab("1", "/a.md"), pinned: true });
    tabStore.addOrActivate({ ...makeTab("2", "/b.md"), pinned: true });
    tabStore.addOrActivate(makeTab("3", "/c.md"));
    tabStore.addOrActivate(makeTab("4", "/d.md"));

    tabStore.moveRelative("4", "3", "before");
    expect(tabStore.tabs.map((tab) => tab.id)).toEqual(["1", "2", "4", "3"]);

    tabStore.moveRelative("4", "2", "before");
    expect(tabStore.tabs.map((tab) => tab.id)).toEqual(["1", "2", "4", "3"]);
  });

  it("閉じたタブを最大10件までLIFO順で保持する", async () => {
    for (let index = 0; index < 12; index++) {
      const id = String(index);
      tabStore.addOrActivate(makeTab(id, `/${id}.md`));
      await tabStore.closeAndUnwatch(id);
    }

    const restored = Array.from({ length: 10 }, () => tabStore.takeRecentlyClosed()?.tab.id);
    expect(restored).toEqual(["11", "10", "9", "8", "7", "6", "5", "4", "3", "2"]);
    expect(tabStore.takeRecentlyClosed()).toBeUndefined();
  });

  it("手動で開き直した文書を閉じた履歴から除き、重複復元を防ぐ", async () => {
    tabStore.addOrActivate(makeTab("a", "/a.md"));
    await tabStore.closeAndUnwatch("a");
    tabStore.addOrActivate(makeTab("b", "/b.md"));
    await tabStore.closeAndUnwatch("b");

    tabStore.addOrActivate(makeTab("b-reopened", "/b.md"));

    expect(tabStore.takeRecentlyClosed()?.tab.id).toBe("a");
    expect(tabStore.takeRecentlyClosed()).toBeUndefined();
  });

  it("他のタブと右側のタブを閉じてもピン留めタブは保持する", async () => {
    tabStore.addOrActivate({ ...makeTab("pin", "/pin.md"), pinned: true });
    tabStore.addOrActivate(makeTab("1", "/a.md"));
    tabStore.addOrActivate(makeTab("2", "/b.md"));
    tabStore.addOrActivate(makeTab("3", "/c.md"));

    await tabStore.closeToRight("1");
    expect(tabStore.tabs.map((tab) => tab.id)).toEqual(["pin", "1"]);

    tabStore.addOrActivate(makeTab("4", "/d.md"));
    await tabStore.closeOthers("4");
    expect(tabStore.tabs.map((tab) => tab.id)).toEqual(["pin", "4"]);
  });

  it("表示モードをタブ単位で保持する", () => {
    tabStore.addOrActivate({ ...makeTab("1", "/a.md"), renderMode: "safe" });
    tabStore.addOrActivate({ ...makeTab("2", "/b.md"), renderMode: "full" });

    tabStore.updateTab("1", { renderMode: "full" });

    expect(tabStore.tabs.find((tab) => tab.id === "1")?.renderMode).toBe("full");
    expect(tabStore.tabs.find((tab) => tab.id === "2")?.renderMode).toBe("full");
  });

  it("同じ実ファイルを参照する別タブが残る間はファイル監視を解除しない", async () => {
    const capabilities = {
      watch: "entries" as const,
      externalEditor: true,
      respectGitignore: true,
      fullTextSearch: true,
      wikiLinks: true,
    };
    const rootSource: DocumentSourceInfo = {
      id: "root",
      kind: "native",
      label: "notes",
      nativePath: "C:/notes",
      capabilities,
    };
    const nestedSource: DocumentSourceInfo = {
      ...rootSource,
      id: "nested",
      nativePath: "C:/notes/guide",
    };
    tabStore.addOrActivate({
      id: "1",
      path: "root:guide%2Fnote.md",
      title: "note.md",
      source: rootSource,
      document: { sourceId: rootSource.id, path: "guide/note.md" },
    });
    tabStore.addOrActivate({
      id: "2",
      path: "nested:note.md",
      title: "note.md",
      source: nestedSource,
      document: { sourceId: nestedSource.id, path: "note.md" },
    });

    await tabStore.closeAndUnwatch("1");
    expect(invoke).not.toHaveBeenCalledWith("unwatch_path", expect.anything());

    await tabStore.closeAndUnwatch("2");
    expect(invoke).toHaveBeenCalledWith("unwatch_path", { path: "C:/notes/guide/note.md" });
  });

  it("監視解除中のピン留めを拒否し、クローズを最後まで確定する", async () => {
    let finishUnwatch: (() => void) | undefined;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishUnwatch = () => resolve()))
    );
    const source: DocumentSourceInfo = {
      id: "native",
      kind: "native",
      label: "notes",
      nativePath: "C:/notes",
      capabilities: {
        watch: "entries",
        externalEditor: true,
        respectGitignore: true,
        fullTextSearch: true,
        wikiLinks: true,
      },
    };
    tabStore.addOrActivate({
      id: "closing",
      path: "native:note.md",
      title: "note.md",
      source,
      document: { sourceId: source.id, path: "note.md" },
    });

    const closing = tabStore.closeAndUnwatch("closing");
    expect(tabStore.tabs.map((tab) => tab.id)).toEqual(["closing"]);
    tabStore.togglePin("closing");
    expect(tabStore.tabs[0].pinned).toBeFalsy();

    finishUnwatch?.();
    await closing;
    expect(tabStore.tabs).toEqual([]);
    expect(tabStore.canReopenClosedTab).toBe(true);
  });
});
