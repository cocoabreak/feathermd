import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import TabBar from "$lib/components/TabBar.svelte";
import { tabStore } from "$lib/stores/tab.svelte";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/menu", () => ({
  MenuItem: { new: vi.fn(async (options) => options) },
  Menu: { new: vi.fn(async (options) => ({ ...options, popup: vi.fn() })) },
}));

describe("TabBar", () => {
  beforeEach(() => {
    for (const tab of [...tabStore.tabs]) {
      if (tab.pinned) tabStore.togglePin(tab.id);
      tabStore.close(tab.id);
    }
    tabStore.clearRecentlyClosed();
    vi.clearAllMocks();
  });

  it("ドラッグに移行しないpointer操作でタブを切り替える", async () => {
    tabStore.addOrActivate({ id: "a", path: "/a.md", title: "a.md" });
    tabStore.addOrActivate({ id: "b", path: "/b.md", title: "b.md" });
    const view = render(TabBar);
    const aHandle = view.getByTitle("/a.md");
    const aTab = aHandle.closest("[data-tab-id]") as HTMLElement;
    Object.defineProperty(aTab, "setPointerCapture", { value: vi.fn(), configurable: true });
    Object.defineProperty(aTab, "releasePointerCapture", { value: vi.fn(), configurable: true });

    await fireEvent.pointerDown(aHandle, {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 20,
      clientY: 18,
    });
    await fireEvent.pointerUp(aTab, { pointerId: 1, clientX: 20, clientY: 18 });

    expect(tabStore.activeTabId).toBe("a");
  });

  it("同じグループのタブをドラッグして並べ替える", async () => {
    tabStore.addOrActivate({ id: "a", path: "/a.md", title: "a.md" });
    tabStore.addOrActivate({ id: "b", path: "/b.md", title: "b.md" });
    const view = render(TabBar);
    const aHandle = view.getByTitle("/a.md");
    const aTab = aHandle.closest("[data-tab-id]") as HTMLElement;
    const bTab = view.getByTitle("/b.md").closest("[data-tab-id]") as HTMLElement;
    Object.defineProperty(aTab, "setPointerCapture", { value: vi.fn(), configurable: true });
    Object.defineProperty(aTab, "releasePointerCapture", { value: vi.fn(), configurable: true });
    vi.spyOn(bTab, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 200,
      top: 0,
      bottom: 36,
      width: 100,
      height: 36,
    } as DOMRect);
    Object.defineProperty(document, "elementFromPoint", {
      value: vi.fn(() => bTab),
      configurable: true,
    });

    await fireEvent.pointerDown(aHandle, {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 20,
      clientY: 18,
    });
    await fireEvent.pointerMove(aTab, { pointerId: 1, clientX: 180, clientY: 18 });
    await fireEvent.pointerUp(aTab, { pointerId: 1, clientX: 180, clientY: 18 });

    expect(tabStore.tabs.map((tab) => tab.id)).toEqual(["b", "a"]);
    expect(aTab).not.toHaveAttribute("draggable");
    expect(aTab.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("右クリックメニューへ対象に応じたタブ操作を表示する", async () => {
    tabStore.addOrActivate({ id: "a", path: "/a.md", title: "a.md" });
    tabStore.addOrActivate({ id: "b", path: "/b.md", title: "b.md" });
    const view = render(TabBar);

    await fireEvent.contextMenu(view.getByTitle("/a.md"));
    await waitFor(() => expect(Menu.new).toHaveBeenCalled());
    const items = (vi.mocked(Menu.new).mock.calls[0]?.[0]?.items ?? []) as Array<{
      text: string;
    }>;

    expect(vi.mocked(MenuItem.new)).toHaveBeenCalled();
    expect(items.map((item) => item.text)).toEqual([
      "Pin tab",
      "Close tab",
      "Close other tabs",
      "Close tabs to the right",
    ]);
  });
});
