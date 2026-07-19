import { describe, it, expect, beforeEach } from "vitest";
import { applyHighlights, clearHighlights } from "./search-highlight";

describe("applyHighlights", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("リテラル一致箇所をmarkでラップする", async () => {
    container.innerHTML = "<p>hello world</p>";
    const { marks, error } = await applyHighlights(container, "world", false);
    expect(error).toBeNull();
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("world");
    expect(container.innerHTML).toContain('<mark class="search-match">world</mark>');
  });

  it("大文字小文字を区別しない", async () => {
    container.innerHTML = "<p>Hello HELLO hello</p>";
    const { marks } = await applyHighlights(container, "hello", false);
    expect(marks).toHaveLength(3);
  });

  it("複数のテキストノードにまたがるマッチを検出する", async () => {
    container.innerHTML = "<p>foo</p><p>bar</p><p>foo</p>";
    const { marks } = await applyHighlights(container, "foo", false);
    expect(marks).toHaveLength(2);
  });

  it("正規表現モードでパターンマッチする", async () => {
    container.innerHTML = "<p>foo1 foo2 bar3</p>";
    const { marks } = await applyHighlights(container, "foo\\d", true);
    expect(marks.map((m) => m.textContent)).toEqual(["foo1", "foo2"]);
  });

  it("リテラルモードでは正規表現特殊文字をそのまま検索する", async () => {
    container.innerHTML = "<p>a.b a1b</p>";
    const { marks } = await applyHighlights(container, "a.b", false);
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("a.b");
  });

  it("不正な正規表現の場合はエラーを返し例外を投げない", async () => {
    container.innerHTML = "<p>hello</p>";
    const { marks, error } = await applyHighlights(container, "(", true);
    expect(marks).toHaveLength(0);
    expect(error).not.toBeNull();
  });

  it("空文字マッチのパターンで無限ループしない", async () => {
    container.innerHTML = "<p>abc</p>";
    const { marks } = await applyHighlights(container, "x*", true);
    expect(marks.length).toBeGreaterThanOrEqual(0);
  });

  it("マッチなしの場合は空配列を返す", async () => {
    container.innerHTML = "<p>hello</p>";
    const { marks, error } = await applyHighlights(container, "notfound", false);
    expect(marks).toHaveLength(0);
    expect(error).toBeNull();
  });

  it("空クエリの場合は何もしない", async () => {
    container.innerHTML = "<p>hello</p>";
    const { marks, error } = await applyHighlights(container, "", false);
    expect(marks).toHaveLength(0);
    expect(error).toBeNull();
  });
});

describe("clearHighlights", () => {
  it("mark要素を取り除きテキストノードに戻す", () => {
    const container = document.createElement("div");
    container.innerHTML = '<p>hello <mark class="search-match">world</mark></p>';

    clearHighlights(container);

    expect(container.querySelectorAll("mark.search-match")).toHaveLength(0);
    expect(container.textContent).toBe("hello world");
  });

  it("再度applyHighlightsしても正しく動作する", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>hello world</p>";
    await applyHighlights(container, "hello", false);

    clearHighlights(container);
    const { marks } = await applyHighlights(container, "world", false);

    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("world");
  });
});
