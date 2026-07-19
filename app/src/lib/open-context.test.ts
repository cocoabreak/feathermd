import { describe, expect, it } from "vitest";
import { isFileOutsideExplorerRoot } from "./open-context";

describe("isFileOutsideExplorerRoot", () => {
  it("表示中ファイルがなければ案内しない", () => {
    expect(isFileOutsideExplorerRoot(null, null)).toBe(false);
  });

  it("ルート未設定で表示中ファイルがあれば案内する", () => {
    expect(isFileOutsideExplorerRoot("C:/docs/a.md", null)).toBe(true);
  });

  it("表示中ファイルがルート配下なら案内しない", () => {
    expect(isFileOutsideExplorerRoot("C:/docs/sub/a.md", "C:/docs")).toBe(false);
  });

  it("表示中ファイルが別ルートなら案内する", () => {
    expect(isFileOutsideExplorerRoot("C:/other/a.md", "C:/docs")).toBe(true);
  });
});
