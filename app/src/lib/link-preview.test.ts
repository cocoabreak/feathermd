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
