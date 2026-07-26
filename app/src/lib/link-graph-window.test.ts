import { describe, expect, it, vi } from "vitest";
import {
  handleLinkGraphOpenRequest,
  isCurrentLinkGraphOpenRequest,
  type LinkGraphDocumentOpenRequest,
  type LinkGraphWindowSnapshot,
} from "$lib/link-graph-window";

const snapshot: LinkGraphWindowSnapshot = {
  contextVersion: 4,
  context: {
    document: { sourceId: "source-1", path: "current.md" },
    revision: 2,
    showHiddenFiles: false,
    respectGitignore: true,
    includeWikiLinks: true,
    locale: "ja",
    dark: false,
  },
};

function request(
  overrides: Partial<LinkGraphDocumentOpenRequest> = {}
): LinkGraphDocumentOpenRequest {
  return {
    contextVersion: 4,
    origin: { sourceId: "source-1", path: "current.md" },
    target: { sourceId: "source-1", path: "target.md" },
    ...overrides,
  };
}

describe("isCurrentLinkGraphOpenRequest", () => {
  it("現在のグラフから同一Source内の文書を開く要求だけを受理する", () => {
    expect(isCurrentLinkGraphOpenRequest(request(), snapshot)).toBe(true);
    expect(
      isCurrentLinkGraphOpenRequest(
        request({ origin: { sourceId: "source-1", path: "previous.md" } }),
        snapshot
      )
    ).toBe(false);
    expect(isCurrentLinkGraphOpenRequest(request({ contextVersion: 3 }), snapshot)).toBe(false);
    expect(
      isCurrentLinkGraphOpenRequest(
        request({ target: { sourceId: "source-2", path: "target.md" } }),
        snapshot
      )
    ).toBe(false);
  });

  it("文書を開けない場合はエラー通知へ渡す", async () => {
    const source = {
      id: "source-1",
      kind: "native",
      label: "notes",
      nativePath: "D:/notes",
      generation: 0,
      capabilities: {
        watch: "entries",
        externalEditor: true,
        respectGitignore: true,
        fullTextSearch: true,
        wikiLinks: true,
      },
    } as const;
    const error = new Error("deleted");
    const notify = vi.fn();
    const opened = await handleLinkGraphOpenRequest(
      request(),
      snapshot,
      source,
      vi.fn().mockRejectedValue(error),
      notify
    );
    expect(opened).toBe(false);
    expect(notify).toHaveBeenCalledWith(error, request().target);
  });
});
