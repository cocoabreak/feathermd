import { describe, it, expect } from "vitest";
import { extractFrontmatter } from "./frontmatter";

describe("extractFrontmatter", () => {
  it("先頭のYAML frontmatterを検出して解析する", () => {
    const raw = "---\ntitle: Hello\ntags: [a, b]\n---\n# Body\n";
    const { data, content } = extractFrontmatter(raw);
    expect(data).toEqual({ title: "Hello", tags: ["a", "b"] });
    expect(content).toBe("# Body\n");
  });

  it("frontmatterがない場合はdata: null、contentは元のまま", () => {
    const raw = "# Body\n\nSome text with --- in it\n";
    const { data, content } = extractFrontmatter(raw);
    expect(data).toBeNull();
    expect(content).toBe(raw);
  });

  it("本文中の水平線を誤ってfrontmatterと認識しない", () => {
    const raw = "# Title\n\n---\n\nBody after hr\n";
    const { data, content } = extractFrontmatter(raw);
    expect(data).toBeNull();
    expect(content).toBe(raw);
  });

  it("不正なYAMLはdata: nullを返しcontentは元のまま", () => {
    const raw = "---\ntitle: [unclosed\n---\nBody\n";
    const { data, content } = extractFrontmatter(raw);
    expect(data).toBeNull();
    expect(content).toBe(raw);
  });

  it("frontmatterがマッピングでない（スカラー/配列単体）場合はdata: null", () => {
    const raw = "---\n- a\n- b\n---\nBody\n";
    const { data, content } = extractFrontmatter(raw);
    expect(data).toBeNull();
    expect(content).toBe(raw);
  });

  it("CRLF改行でも検出できる", () => {
    const raw = "---\r\ntitle: Hello\r\n---\r\nBody\r\n";
    const { data, content } = extractFrontmatter(raw);
    expect(data).toEqual({ title: "Hello" });
    expect(content).toBe("Body\r\n");
  });
});
