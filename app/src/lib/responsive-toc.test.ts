import { describe, expect, it } from "vitest";
import { TOC_DRAWER_MEDIA_QUERY, usesTocDrawer } from "./responsive-toc";

describe("responsive TOC layout", () => {
  it("1000px未満だけドロワー表示にする", () => {
    expect(usesTocDrawer(999)).toBe(true);
    expect(usesTocDrawer(1000)).toBe(false);
    expect(usesTocDrawer(1280)).toBe(false);
    expect(TOC_DRAWER_MEDIA_QUERY).toBe("(max-width: 999px)");
  });
});
