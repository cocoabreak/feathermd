import { beforeEach, describe, expect, it } from "vitest";
import { tocStore } from "./toc.svelte";

describe("tocStore", () => {
  beforeEach(() => {
    tocStore.setHeadings([]);
    tocStore.setActiveId(null);
  });

  it("セーフモード目次の省略状態を保持する", () => {
    tocStore.setSafeOutline([{ level: 1, text: "Heading", id: "safe-heading-0" }], true);

    expect(tocStore.headings).toHaveLength(1);
    expect(tocStore.headings[0]?.referenceId).toBe("heading");
    expect(tocStore.truncated).toBe(true);
  });

  it("セーフモード目次にも通常レンダーと同じ重複アンカーを付ける", () => {
    tocStore.setSafeOutline(
      [
        { level: 1, text: "日本語", id: "safe-heading-0" },
        { level: 2, text: "日本語", id: "safe-heading-1" },
      ],
      false
    );

    expect(tocStore.headings.map((heading) => heading.referenceId)).toEqual(["日本語", "日本語-1"]);
  });

  it("空見出しも後続見出しのフォールバック採番へ含める", () => {
    tocStore.setSafeOutline(
      [
        { level: 1, text: "", id: "safe-heading-0" },
        { level: 2, text: "!!!", id: "safe-heading-1" },
      ],
      false
    );

    expect(tocStore.headings.map((heading) => heading.referenceId)).toEqual([
      "heading-0",
      "heading-1",
    ]);
  });

  it("safe outlineの構造保持テキストからemojiとコードを区別する", () => {
    tocStore.setSafeOutline(
      [
        {
          level: 1,
          text: "Win :trophy:",
          anchorText: "Win :trophy:",
          id: "safe-heading-0",
        },
        {
          level: 2,
          text: "Code :trophy:",
          anchorText: "Code trophy",
          id: "safe-heading-1",
        },
        {
          level: 3,
          text: "Smile :D",
          anchorText: "Smile :D",
          id: "safe-heading-2",
        },
        {
          level: 4,
          text: "Literal :D",
          anchorText: "Literal D",
          id: "safe-heading-3",
        },
      ],
      false
    );

    expect(tocStore.headings.map((heading) => heading.referenceId)).toEqual([
      "win",
      "code-trophy",
      "smile",
      "literal-d",
    ]);
  });

  it("通常目次を設定すると省略状態を解除する", () => {
    tocStore.setSafeOutline([{ level: 1, text: "Safe", id: "safe-heading-0" }], true);
    tocStore.setHeadings([{ level: 2, text: "Normal", id: "normal" }]);

    expect(tocStore.truncated).toBe(false);
    expect(tocStore.headings[0]?.id).toBe("normal");
  });
});
