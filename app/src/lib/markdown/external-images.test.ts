import { describe, expect, it } from "vitest";
import { protectExternalImages } from "./external-images";

describe("protectExternalImages", () => {
  it("外部imgのsrcをDOM挿入前に退避する", () => {
    const result = protectExternalImages(
      '<p><img src="https://example.com/a.png"><img src="//cdn.example.com/b.png"></p>'
    );

    expect(result.blockedCount).toBe(2);
    const template = document.createElement("template");
    template.innerHTML = result.html;
    expect(
      [...template.content.querySelectorAll("img")].every((img) => !img.hasAttribute("src"))
    ).toBe(true);
    expect(result.html).toContain('data-external-src="https://example.com/a.png"');
    expect(result.html).toContain('data-external-src="//cdn.example.com/b.png"');
  });

  it("ローカル画像とdata画像は変更しない", () => {
    const html = '<img src="./local.png"><img src="data:image/png;base64,AAAA">';
    expect(protectExternalImages(html)).toEqual({ html, blockedCount: 0 });
  });

  it("srcset全体を退避しpictureの要素数を数える", () => {
    const result = protectExternalImages(
      '<picture><source srcset="https://example.com/a.webp 1x, ./b.webp 2x"><img srcset="https://example.com/a.png 1x"></picture>'
    );

    expect(result.blockedCount).toBe(2);
    expect(result.html).not.toContain(" srcset=");
    expect(result.html).toContain("data-external-srcset");
  });

  it("SVG画像、poster、画像入力、外部URLを含むstyleを保護する", () => {
    const result = protectExternalImages(
      '<svg><image href="https://example.com/a.svg"></image></svg>' +
        '<video poster="https://example.com/poster.png"></video>' +
        '<input type="image" src="https://example.com/button.png">' +
        '<div style="background:u\\72l(https://example.com/bg.png)"></div>'
    );

    expect(result.blockedCount).toBe(4);
    const template = document.createElement("template");
    template.innerHTML = result.html;
    expect(template.content.querySelector("image")?.hasAttribute("href")).toBe(false);
    expect(template.content.querySelector("video")?.hasAttribute("poster")).toBe(false);
    expect(template.content.querySelector("input")?.hasAttribute("src")).toBe(false);
    expect(template.content.querySelector("div")?.hasAttribute("style")).toBe(false);
    expect(result.html).toContain("data-external-href");
    expect(result.html).toContain("data-external-poster");
    expect(result.html).toContain("data-external-style");
  });

  it("URL Standardで正規化される空白・バックスラッシュ入りURLを保護する", () => {
    const result = protectExternalImages(
      '<img src="ht\ntps://example.com/a.png"><img src="https:\\\\example.com\\b.png">'
    );
    expect(result.blockedCount).toBe(2);
  });

  it("SVGの外部参照とCSS URL関数を保護する", () => {
    const result = protectExternalImages(
      '<svg><use href="https://example.com/icons.svg#x"></use>' +
        '<feImage href="https://example.com/filter.png"></feImage>' +
        '<path fill="url(https://example.com/fill.svg#x)"></path></svg>' +
        '<div style="background:url(https://example.com/bg.png)"></div>'
    );
    expect(result.blockedCount).toBe(4);
    expect(result.html).toContain("data-external-fill");
  });
});
