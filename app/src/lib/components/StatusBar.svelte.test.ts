import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import StatusBar from "./StatusBar.svelte";
import { tabStore } from "$lib/stores/tab.svelte";
import { i18n } from "$lib/i18n/index.svelte";

describe("StatusBar", () => {
  beforeEach(() => {
    // 初期ロケールは実行環境のnavigator.languageに依存するため、jaへ固定する
    i18n.setLocale("ja");
    for (const tab of [...tabStore.tabs]) {
      tabStore.close(tab.id);
    }
  });

  it("アクティブなタブがない場合は準備完了メッセージを表示する", () => {
    render(StatusBar);

    expect(screen.getByText("準備完了")).toBeInTheDocument();
  });

  it("アクティブなタブがある場合はそのパスを表示する", () => {
    tabStore.addOrActivate({ id: "1", path: "/docs/readme.md", title: "readme.md" });

    render(StatusBar);

    expect(screen.getByText("/docs/readme.md")).toBeInTheDocument();
  });

  it("通常タブのレンダー表示とソース表示を切り替える", async () => {
    tabStore.addOrActivate({ id: "1", path: "/docs/readme.md", title: "readme.md" });
    render(StatusBar);

    const sourceButton = screen.getByRole("button", { name: "元のMarkdownを表示" });
    expect(sourceButton).toHaveTextContent("レンダー");
    await fireEvent.click(sourceButton);

    expect(tabStore.tabs[0].viewMode).toBe("source");
    expect(screen.getByRole("button", { name: "レンダリング結果を表示" })).toHaveTextContent(
      "ソース"
    );
  });

  it("大容量セーフモードでは重複する表示切替を出さない", () => {
    tabStore.addOrActivate({
      id: "safe",
      path: "/docs/large.md",
      title: "large.md",
      renderMode: "safe",
    });
    render(StatusBar);

    expect(screen.queryByRole("button", { name: "元のMarkdownを表示" })).not.toBeInTheDocument();
  });
});
