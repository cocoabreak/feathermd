import { describe, expect, it } from "vitest";
import { hasRenderedContextContent } from "./context-menu";

describe("hasRenderedContextContent", () => {
  it("通常のレンダー表示だけを描画済みHTML操作の対象にする", () => {
    expect(hasRenderedContextContent("full", "rendered")).toBe(true);
    expect(hasRenderedContextContent("full", undefined)).toBe(true);
    expect(hasRenderedContextContent("full", "source")).toBe(false);
    expect(hasRenderedContextContent("safe", "rendered")).toBe(false);
  });
});
