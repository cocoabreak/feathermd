import { beforeEach, describe, expect, it } from "vitest";
import { tabStore } from "$lib/stores/tab.svelte";
import { toggleActiveSourceView } from "./view-actions";

describe("toggleActiveSourceView", () => {
  beforeEach(() => {
    for (const tab of [...tabStore.tabs]) tabStore.close(tab.id);
  });

  it("アクティブタブだけの表示モードを切り替える", () => {
    tabStore.addOrActivate({ id: "1", path: "/one.md", title: "one.md" });
    tabStore.addOrActivate({ id: "2", path: "/two.md", title: "two.md" });
    tabStore.setActive("1");

    toggleActiveSourceView();

    expect(tabStore.tabs.find((tab) => tab.id === "1")?.viewMode).toBe("source");
    expect(tabStore.tabs.find((tab) => tab.id === "2")?.viewMode).toBeUndefined();

    toggleActiveSourceView();
    expect(tabStore.tabs.find((tab) => tab.id === "1")?.viewMode).toBe("rendered");
  });

  it("大容量セーフモードでは切り替えない", () => {
    tabStore.addOrActivate({
      id: "safe",
      path: "/large.md",
      title: "large.md",
      renderMode: "safe",
    });

    toggleActiveSourceView();

    expect(tabStore.tabs[0].viewMode).toBeUndefined();
  });
});
