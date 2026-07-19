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
    expect(tocStore.truncated).toBe(true);
  });

  it("通常目次を設定すると省略状態を解除する", () => {
    tocStore.setSafeOutline([{ level: 1, text: "Safe", id: "safe-heading-0" }], true);
    tocStore.setHeadings([{ level: 2, text: "Normal", id: "normal" }]);

    expect(tocStore.truncated).toBe(false);
    expect(tocStore.headings[0]?.id).toBe("normal");
  });
});
