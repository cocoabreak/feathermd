import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "$lib/markdown/sanitize";
import wikiLinksPlugin from "$lib/plugins/wiki-links";
import dialectPlugin from ".";

function render(markdown: string, wikiLinks = false): string {
  const md = new MarkdownIt({ html: true, linkify: true });
  dialectPlugin.extendMarkdownIt?.(md);
  if (wikiLinks) wikiLinksPlugin.extendMarkdownIt?.(md);
  return sanitizeHtml(md.render(markdown));
}

function occurrences(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

describe("Callouts", () => {
  it.each([
    "note",
    "abstract",
    "info",
    "todo",
    "tip",
    "important",
    "success",
    "question",
    "warning",
    "caution",
    "failure",
    "danger",
    "bug",
    "example",
    "quote",
  ])("正規種別%sを大文字小文字を区別せず描画する", (type) => {
    const html = render(`> [!${type.toUpperCase()}]\n> Body`);

    expect(html).toContain(`<aside class="callout callout-${type}" data-callout="${type}">`);
    expect(html).toContain("Body");
  });

  it.each([
    ["summary", "abstract"],
    ["tldr", "abstract"],
    ["hint", "tip"],
    ["check", "success"],
    ["done", "success"],
    ["help", "question"],
    ["faq", "question"],
    ["fail", "failure"],
    ["missing", "failure"],
    ["error", "danger"],
    ["cite", "quote"],
  ])("別名%sを%sへ正規化する", (alias, canonical) => {
    const html = render(`> [!${alias}]\n> Body`);

    expect(html).toContain(`class="callout callout-${canonical}"`);
    expect(html).toContain(`data-callout="${canonical}"`);
  });

  it("既定タイトルとインラインMarkdownのカスタムタイトルを描画する", () => {
    const defaultTitle = render("> [!note]\n> Body");
    const customTitle = render("> [!tip] Custom *title* with `code`\n> Body");

    expect(defaultTitle).toContain('<span class="callout-title-text">Note</span>');
    expect(customTitle).toContain(
      '<span class="callout-title-text">Custom <em>title</em> with <code>code</code></span>'
    );
  });

  it("折りたたみ指定をdetailsの初期状態へ反映する", () => {
    const open = render("> [!example]+ Open\n> Body");
    const closed = render("> [!question]- Closed\n> Body");

    expect(open).toContain(
      '<details class="callout callout-example" data-callout="example" open="">'
    );
    expect(open).toContain('<summary class="callout-title">');
    expect(closed).toContain('<details class="callout callout-question" data-callout="question">');
    expect(closed).not.toContain(" open=");
  });

  it("本文でMarkdown・Wikiリンク・画像・コードブロックを維持する", () => {
    const html = render(
      [
        "> [!note] Rich body",
        ">",
        "> - **bold** and [[guide|Wiki label]]",
        "> - ![pixel](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)",
        ">",
        "> ```js",
        "> const answer = 42;",
        "> ```",
      ].join("\n"),
      true
    );

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-wiki-target="guide"');
    expect(html).toContain("<img");
    expect(html).toContain('<code class="language-js">');
    expect(html).toContain("const answer = 42;");
  });

  it("4段まで入れ子Calloutへ変換し5段目は通常引用へ残す", () => {
    const html = render(
      [
        "> [!note] Level 1",
        "> > [!tip] Level 2",
        "> > > [!success] Level 3",
        "> > > > [!warning] Level 4",
        "> > > > > [!danger] Level 5",
        "> > > > > Body",
      ].join("\n")
    );

    expect(occurrences(html, /class="callout callout-/g)).toBe(4);
    expect(html).toContain("[!danger] Level 5");
    expect(html).toContain("<blockquote>");
  });

  it("257個目は通常引用へ残す", () => {
    const markdown = Array.from(
      { length: 257 },
      (_, index) => `> [!note] Item ${index + 1}\n> Body`
    ).join("\n\n");
    const html = render(markdown);

    expect(occurrences(html, /class="callout callout-note"/g)).toBe(256);
    expect(html).toContain("[!note] Item 257");
    expect(occurrences(html, /<blockquote>/g)).toBe(1);
  });

  it("大量の通常引用や未知マーカーをCallout候補として保持しない", () => {
    const markdown = Array.from({ length: 2_048 }, (_, index) =>
      index % 2 === 0 ? `> Plain quote ${index}` : `> [!unknown] Quote ${index}`
    ).join("\n\n");
    const html = render(markdown);

    expect(occurrences(html, /<blockquote>/g)).toBe(2_048);
    expect(html).not.toContain('class="callout');
  });

  it("256文字のタイトルを許可し257文字は通常引用へ残す", () => {
    const accepted = render(`> [!note] ${"a".repeat(256)}\n> Body`);
    const rejected = render(`> [!note] ${"a".repeat(257)}\n> Body`);

    expect(accepted).toContain('class="callout callout-note"');
    expect(rejected).not.toContain('class="callout callout-note"');
    expect(rejected).toContain("<blockquote>");
  });

  it.each(["unknown", "", "note.value", "123"])(
    "未対応または不正な種別%sを通常引用へ残す",
    (type) => {
      const html = render(`> [!${type}] Title\n> Body`);

      expect(html).not.toContain('class="callout');
      expect(html).toContain("<blockquote>");
    }
  );

  it("タイトルと固定SVGを既存sanitizeへ通す", () => {
    const html = render(
      '> [!note] <img src="x" onerror="alert(1)"><script>alert(2)</script>\n> Body'
    );

    expect(html).toContain('class="callout-icon"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("通常の引用とエスケープされたマーカーを変換しない", () => {
    const plain = render("> Plain quote");
    const escaped = render("> \\[!note] Escaped marker");

    expect(plain).toContain("<blockquote>");
    expect(escaped).toContain("<blockquote>");
    expect(plain).not.toContain('class="callout');
    expect(escaped).not.toContain('class="callout');
  });
});
