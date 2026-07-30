import { describe, expect, it } from "vitest";
import type { DocumentSourceInfo } from "$lib/types";
import { formatReference, type ReferenceTarget } from "./reference-copy";

const nativeSource: DocumentSourceInfo = {
  id: "native",
  kind: "native",
  label: "notes",
  nativePath: "D:/notes",
  capabilities: {
    watch: "entries",
    externalEditor: true,
    respectGitignore: true,
    fullTextSearch: true,
    wikiLinks: true,
  },
};

const target: ReferenceTarget = {
  document: { sourceId: nativeSource.id, path: "docs/guide.md" },
  source: nativeSource,
  title: "guide.md",
  heading: { level: 2, text: "日本語の設定", id: "日本語の設定" },
};

describe("formatReference", () => {
  it("Sourceルート基準の文書参照を生成する", () => {
    expect(formatReference("wiki", target)).toBe("[[docs/guide.md]]");
    expect(formatReference("markdown", target)).toBe("[guide](</docs/guide.md>)");
    expect(formatReference("path", target)).toBe("D:/notes/docs/guide.md");
  });

  it("一意な見出しIDを使った参照を生成する", () => {
    expect(formatReference("heading-wiki", target)).toBe("[[docs/guide.md#日本語の設定]]");
    expect(formatReference("heading-markdown", target)).toBe(
      "[guide — 日本語の設定](</docs/guide.md#%E6%97%A5%E6%9C%AC%E8%AA%9E%E3%81%AE%E8%A8%AD%E5%AE%9A>)"
    );
    expect(formatReference("heading-name", target)).toBe("日本語の設定");
  });

  it("Markdown表示名をエスケープする", () => {
    expect(
      formatReference("markdown", {
        ...target,
        document: { ...target.document, path: "docs/[draft].md" },
      })
    ).toBe("[\\[draft\\]](</docs/[draft].md>)");
  });

  it("見出しラベルのHTML境界をエスケープし、改行を空白へ正規化する", () => {
    expect(
      formatReference("heading-markdown", {
        ...target,
        heading: {
          level: 2,
          text: "<img src=x onerror=alert(1)>\r\nnext",
          id: "safe",
        },
      })
    ).toBe("[guide — \\<img src=x onerror=alert(1)\\> next](</docs/guide.md#safe>)");
    expect(() =>
      formatReference("heading-markdown", {
        ...target,
        heading: { level: 2, text: "bad\0label", id: "safe" },
      })
    ).toThrow("unsupported-markdown-label");
  });

  it("ZipSourceではアーカイブとエントリを含む表示パスを返す", () => {
    expect(
      formatReference("path", {
        ...target,
        document: { sourceId: "zip", path: "docs/guide.md" },
        source: {
          ...nativeSource,
          id: "zip",
          kind: "zip",
          nativePath: "D:/notes/docs.zip",
          capabilities: { ...nativeSource.capabilities, externalEditor: false },
        },
      })
    ).toBe("D:/notes/docs.zip / docs/guide.md");
  });

  it("Wiki構文で安全に表現できないパスを拒否する", () => {
    expect(() =>
      formatReference("wiki", {
        ...target,
        document: { ...target.document, path: "docs/a#b.md" },
      })
    ).toThrow("unsupported-wiki-target");
  });

  it("Markdown構文の区切り文字を文書パスとアンカーで符号化する", () => {
    expect(
      formatReference("heading-markdown", {
        ...target,
        document: { ...target.document, path: "docs/a#b%20?.md" },
        heading: { level: 2, text: "custom", id: "a]|#b" },
      })
    ).toBe("[a#b%20? — custom](</docs/a%23b%2520%3F.md#a%5D%7C%23b>)");
  });

  it("Wikiアンカーから構文を注入できるカスタムIDを拒否する", () => {
    expect(() =>
      formatReference("heading-wiki", {
        ...target,
        heading: { level: 2, text: "custom", id: "safe]]|alias#x" },
      })
    ).toThrow("unsupported-wiki-target");
  });
});
