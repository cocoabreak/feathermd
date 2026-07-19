import { describe, expect, it } from "vitest";
import { splitSourceAtHeadings } from "./source-segments";

describe("splitSourceAtHeadings", () => {
  it("UTF-16 offsetへ見出しアンカーを挿入して原文を保持する", () => {
    const source = "😀 intro\n# Heading\nbody";
    const offset = source.indexOf("# Heading");
    const segments = splitSourceAtHeadings(source, [
      { level: 1, text: "Heading", id: "safe-heading-0", utf16Offset: offset },
    ]);

    expect(segments.map((segment) => segment.text).join("")).toBe(source);
    expect(segments.find((segment) => segment.heading)?.heading?.id).toBe("safe-heading-0");
  });

  it("範囲外または逆順のoffsetを安全にクランプする", () => {
    const segments = splitSourceAtHeadings("abc", [
      { level: 1, text: "A", id: "a", utf16Offset: 99 },
      { level: 2, text: "B", id: "b", utf16Offset: -1 },
    ]);

    expect(segments.map((segment) => segment.text).join("")).toBe("abc");
    expect(segments.filter((segment) => segment.heading)).toHaveLength(2);
  });
});
