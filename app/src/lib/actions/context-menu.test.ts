import { describe, expect, it } from "vitest";
import { findTargetHeading, hasRenderedContextContent } from "./context-menu";

describe("hasRenderedContextContent", () => {
  it("通常のレンダー表示だけを描画済みHTML操作の対象にする", () => {
    expect(hasRenderedContextContent("full", "rendered")).toBe(true);
    expect(hasRenderedContextContent("full", undefined)).toBe(true);
    expect(hasRenderedContextContent("full", "source")).toBe(false);
    expect(hasRenderedContextContent("safe", "rendered")).toBe(false);
  });

  it("右クリック位置から信頼済みコンテンツ内の見出しだけを取得する", () => {
    const content = document.createElement("div");
    content.innerHTML = '<h2 id="details"><span>Details</span></h2>';
    const span = content.querySelector("span")!;
    const event = new MouseEvent("contextmenu");
    Object.defineProperty(event, "target", { value: span });
    expect(findTargetHeading(event, content)).toEqual({
      level: 2,
      text: "Details",
      id: "details",
    });

    const outside = document.createElement("h1");
    outside.id = "outside";
    const outsideEvent = new MouseEvent("contextmenu");
    Object.defineProperty(outsideEvent, "target", { value: outside });
    expect(findTargetHeading(outsideEvent, content)).toBeNull();
  });

  it("セーフ／ソース表示ではUI側の見出しを文書見出しとして扱わない", () => {
    const content = document.createElement("div");
    content.innerHTML = '<h2 id="safe-mode-title">Safe mode</h2>';
    const event = new MouseEvent("contextmenu");
    Object.defineProperty(event, "target", { value: content.querySelector("h2") });
    expect(findTargetHeading(event, content, false)).toBeNull();
  });
});
