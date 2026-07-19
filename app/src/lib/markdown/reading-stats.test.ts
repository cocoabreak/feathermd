import { describe, it, expect } from "vitest";
import { computeReadingStats } from "./reading-stats";

function makeContainer(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("computeReadingStats", () => {
  it("CJK比率が高い文章は文字数ベースで判定する", () => {
    const container = makeContainer(`<p>${"あ".repeat(1000)}</p>`);
    const stats = computeReadingStats(container);
    expect(stats?.isCjk).toBe(true);
    expect(stats?.charCount).toBe(1000);
    expect(stats?.wordCount).toBeNull();
    expect(stats?.minutes).toBe(2); // 1000 / 500 = 2
  });

  it("CJK比率が低い文章は単語数ベースで判定する", () => {
    const words = Array(400).fill("word").join(" ");
    const container = makeContainer(`<p>${words}</p>`);
    const stats = computeReadingStats(container);
    expect(stats?.isCjk).toBe(false);
    expect(stats?.wordCount).toBe(400);
    expect(stats?.minutes).toBe(2); // 400 / 200 = 2
  });

  it("コードブロック(pre)の内容を文字数に含めない", () => {
    const container = makeContainer(
      `<p>${"あ".repeat(100)}</p><pre><code>${"x".repeat(5000)}</code></pre>`
    );
    const stats = computeReadingStats(container);
    expect(stats?.charCount).toBe(100);
  });

  it("Mermaid図(svg)の内容を文字数に含めない", () => {
    const container = makeContainer(
      `<p>${"あ".repeat(100)}</p><svg><text>${"ラベル".repeat(50)}</text></svg>`
    );
    const stats = computeReadingStats(container);
    expect(stats?.charCount).toBe(100);
  });

  it("本文が空（コードブロックのみ）の場合はnullを返す", () => {
    const container = makeContainer(`<pre><code>${"x".repeat(100)}</code></pre>`);
    expect(computeReadingStats(container)).toBeNull();
  });

  it("完全に空のコンテナはnullを返す", () => {
    const container = makeContainer("");
    expect(computeReadingStats(container)).toBeNull();
  });

  it("読了時間は切り上げで最低1分になる", () => {
    const container = makeContainer(`<p>${"あ".repeat(10)}</p>`);
    const stats = computeReadingStats(container);
    expect(stats?.minutes).toBe(1);
  });
});
