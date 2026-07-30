import { describe, expect, it, vi } from "vitest";
import { buildToc, scrollToAnchor } from "./toc-dom";

describe("toc DOM", () => {
  it("Unicodeと重複見出しへ一意なIDを付ける", () => {
    const container = document.createElement("div");
    container.innerHTML = "<h1>日本語の設定</h1><h2>日本語の設定</h2><h3>!!!</h3>";
    expect(buildToc(container)).toEqual([
      { level: 1, text: "日本語の設定", id: "日本語の設定" },
      { level: 2, text: "日本語の設定", id: "日本語の設定-1" },
      { level: 3, text: "!!!", id: "heading-2" },
    ]);
  });

  it("percent-encoded Unicodeアンカーへスクロールする", () => {
    const container = document.createElement("div");
    container.innerHTML = "<h1>日本語の設定</h1>";
    buildToc(container);
    const heading = container.querySelector("h1")!;
    heading.scrollIntoView = vi.fn();
    scrollToAnchor(container, "%E6%97%A5%E6%9C%AC%E8%AA%9E%E3%81%AE%E8%A8%AD%E5%AE%9A");
    expect(heading.scrollIntoView).toHaveBeenCalled();
  });

  it("60文字で切り詰めたslug同士の衝突も一意にする", () => {
    const container = document.createElement("div");
    const prefix = "a".repeat(60);
    container.innerHTML = `<h1>${prefix}x</h1><h2>${prefix}y</h2>`;
    expect(buildToc(container).map((heading) => heading.id)).toEqual([prefix, `${prefix}-1`]);
  });

  it("展開済みemojiとインラインコード内のshortcodeを区別する", () => {
    const container = document.createElement("div");
    container.innerHTML =
      "<h1>Win 🏆</h1><h2>Code <code>:trophy:</code></h2><h3>Smile 😄</h3><h4>Literal <code>:D</code></h4>";
    expect(buildToc(container).map((heading) => heading.id)).toEqual([
      "win",
      "code-trophy",
      "smile",
      "literal-d",
    ]);
  });

  it("KaTeXと脚注の描画要素をsafe outlineと同じアンカーへ正規化する", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <h1>Value <span class="katex">
        <span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow>
          <annotation encoding="application/x-tex">x</annotation>
        </semantics></math></span>
        <span class="katex-html">rendered x</span>
      </span></h1>
      <h2>Heading<sup class="footnote-ref"><a href="#fn1">[1]</a></sup></h2>
    `;

    expect(buildToc(container).map((heading) => heading.id)).toEqual(["value-x", "heading"]);
  });
});
