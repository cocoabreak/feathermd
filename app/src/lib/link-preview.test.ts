import { describe, expect, it } from "vitest";
import { extractLinkPreview } from "./link-preview";

describe("extractLinkPreview", () => {
  it("frontmatterと対象見出し直後のプレーンテキストを抽出する", () => {
    const preview = extractLinkPreview(
      `---
title: Preview title
aliases: [one, two]
tags: docs
---
# Intro
ignored
## Details
Text with **bold**, [link](target.md), ![image](image.png), and \`code\`.

<script>alert(1)</script>
`,
      "guide/target.md",
      "details",
      false
    );

    expect(preview.title).toBe("Preview title");
    expect(preview.heading).toBe("Details");
    expect(preview.excerpt).toContain("Text with bold, link");
    expect(preview.excerpt).not.toContain("image");
    expect(preview.excerpt).not.toContain("code");
    expect(preview.excerpt).not.toContain("alert");
    expect(preview.aliases).toEqual(["one", "two"]);
    expect(preview.tags).toEqual(["docs"]);
  });

  it("見出しが読込範囲外なら冒頭へフォールバックしない", () => {
    const preview = extractLinkPreview("# Intro\nBody", "target.md", "missing", true);
    expect(preview.headingOutOfRange).toBe(true);
    expect(preview.excerpt).toBe("");
  });

  it("重複見出しの連番付きアンカーを出現順で解決する", () => {
    const preview = extractLinkPreview(
      "# Details\nFirst\n# Details\nSecond",
      "target.md",
      "details-1",
      false
    );
    expect(preview.heading).toBe("Details");
    expect(preview.excerpt).toBe("Second");
  });

  it("Unicode見出しとpercent-encodedアンカーを共通slugで解決する", () => {
    const preview = extractLinkPreview(
      "# はじめに\nIntro\n## 日本語の設定\n本文",
      "target.md",
      "%E6%97%A5%E6%9C%AC%E8%AA%9E%E3%81%AE%E8%A8%AD%E5%AE%9A",
      false
    );
    expect(preview.heading).toBe("日本語の設定");
    expect(preview.excerpt).toBe("本文");
  });

  it("60文字へ切り詰めた見出しと衝突サフィックスをDOMと同じ規則で解決する", () => {
    const prefix = "a".repeat(60);
    const preview = extractLinkPreview(
      `# ${prefix}x\nFirst\n# ${prefix}y\nSecond`,
      "target.md",
      `${prefix}-1`,
      false
    );
    expect(preview.heading).toBe(`${prefix}y`);
    expect(preview.excerpt).toBe("Second");
  });

  it("インラインコードを含む見出しをDOMと同じアンカーで解決する", () => {
    const preview = extractLinkPreview("# API `code`\nDetails", "target.md", "api-code", false);
    expect(preview.heading).toBe("API code");
    expect(preview.excerpt).toBe("Details");
  });

  it("通常テキストのemoji shortcodeとインラインコードを区別する", () => {
    expect(extractLinkPreview("# Win :trophy:\nWinner", "target.md", "win", false).heading).toBe(
      "Win :trophy:"
    );
    expect(
      extractLinkPreview("# Code `:trophy:`\nLiteral", "target.md", "code-trophy", false).heading
    ).toBe("Code :trophy:");
    expect(extractLinkPreview("# Smile :D\nHappy", "target.md", "smile", false).heading).toBe(
      "Smile :D"
    );
    expect(
      extractLinkPreview("# Literal `:D`\nCode", "target.md", "literal-d", false).heading
    ).toBe("Literal :D");
  });

  it("KaTeXソースと脚注参照をsafe outlineと同じアンカーで解決する", () => {
    expect(extractLinkPreview("# Value $x$\nMath", "target.md", "value-x", false).heading).toBe(
      "Value $x$"
    );
    expect(
      extractLinkPreview("# Heading[^n]\nFootnote\n\n[^n]: Note", "target.md", "heading", false)
        .heading
    ).toBe("Heading");
  });

  it("巨大メタデータと抜粋を上限内へ切り詰める", () => {
    const aliases = Array.from({ length: 100 }, (_, index) => `"${index}-${"a".repeat(300)}"`).join(
      ", "
    );
    const preview = extractLinkPreview(
      `---
title: ${"t".repeat(400)}
aliases: [${aliases}]
---
${"body ".repeat(200)}
`,
      "target.md",
      null,
      true
    );
    expect(Array.from(preview.title)).toHaveLength(256);
    expect(preview.aliases.length).toBeLessThanOrEqual(32);
    expect(Array.from(preview.excerpt).length).toBeLessThanOrEqual(320);
    expect(preview.metadataTruncated).toBe(true);
  });

  it("型不一致のfrontmatter値を表示しない", () => {
    const preview = extractLinkPreview(
      "---\ntitle: [bad]\naliases: { nested: bad }\ntags: [ok, 3]\n---\nBody",
      "target.md",
      null,
      false
    );
    expect(preview.title).toBe("target.md");
    expect(preview.aliases).toEqual([]);
    expect(preview.tags).toEqual(["ok"]);
  });
});
