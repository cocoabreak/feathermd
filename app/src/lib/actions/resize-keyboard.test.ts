import { describe, expect, it } from "vitest";
import { resizeFromKey } from "./resize-keyboard";

describe("resizeFromKey", () => {
  it("方向に応じて10px、Shift時は50px変更する", () => {
    expect(resizeFromKey("right", 200, 100, 300, "ArrowRight", false)).toBe(210);
    expect(resizeFromKey("right", 200, 100, 300, "ArrowLeft", true)).toBe(150);
    expect(resizeFromKey("top", 200, 100, 300, "ArrowUp", false)).toBe(210);
  });

  it("Home/Endと範囲制限を処理する", () => {
    expect(resizeFromKey("right", 200, 100, 300, "Home", false)).toBe(100);
    expect(resizeFromKey("right", 200, 100, 300, "End", false)).toBe(300);
    expect(resizeFromKey("right", 295, 100, 300, "ArrowRight", false)).toBe(300);
    expect(resizeFromKey("right", 200, 100, 300, "Enter", false)).toBeNull();
  });
});
