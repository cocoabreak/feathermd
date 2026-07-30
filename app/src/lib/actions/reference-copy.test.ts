import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceTarget } from "$lib/reference-copy";
import { referenceCopyFeedbackStore } from "$lib/stores/reference-copy.svelte";
import { copyReference } from "./reference-copy";

const writeText = vi.fn();
const target: ReferenceTarget = {
  document: { sourceId: "native", path: "guide.md" },
  source: {
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
  },
  title: "guide.md",
};

beforeEach(() => {
  writeText.mockReset();
  referenceCopyFeedbackStore.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

describe("copyReference", () => {
  it("生成した参照をClipboard APIへ渡して成功を通知する", async () => {
    writeText.mockResolvedValue(undefined);
    await expect(copyReference("markdown", target)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("[guide](</guide.md>)");
    expect(referenceCopyFeedbackStore.feedback?.kind).toBe("success");
  });

  it("Clipboard APIの拒否を捕捉して失敗を通知する", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await expect(copyReference("wiki", target)).resolves.toBe(false);
    expect(referenceCopyFeedbackStore.feedback?.kind).toBe("error");
  });
});
