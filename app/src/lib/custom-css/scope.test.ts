import { describe, expect, it } from "vitest";
import { scopeCustomCss } from "./scope";

describe("scopeCustomCss", () => {
  it("通常セレクタをmarkdown-body配下へスコープする", async () => {
    const result = await scopeCustomCss("h1, p.note { color: red; }");
    expect(result).toContain(".markdown-body h1, .markdown-body p.note");
  });

  it("media内を変換し、keyframesのセレクタは変換しない", async () => {
    const result = await scopeCustomCss(
      "@media print { p { color: black } } @keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
    );
    expect(result).toContain("@media print { .markdown-body p");
    expect(result).toContain("@keyframes fade { from");
    expect(result).not.toContain(".markdown-body from");
  });

  it("既存のmarkdown-bodyセレクタを二重化しない", async () => {
    const result = await scopeCustomCss(".markdown-body .katex { font-size: 1.2em }");
    expect(result).not.toContain(".markdown-body .markdown-body");
  });

  it(":rootとbodyはコンテンツルート自身へ変換する", async () => {
    const result = await scopeCustomCss(":root, body { --content-color: red }");
    expect(result).toContain(".markdown-body, .markdown-body");
  });

  it("@importを拒否する", async () => {
    await expect(scopeCustomCss('@import "theme.css";')).rejects.toThrow("@import");
  });

  it("url()を拒否する", async () => {
    await expect(scopeCustomCss("p { background: url('./image.png') }")).rejects.toThrow("url()");
  });

  it("構文エラーを拒否する", async () => {
    await expect(scopeCustomCss("h1 { color: red")).rejects.toThrow();
  });
});
