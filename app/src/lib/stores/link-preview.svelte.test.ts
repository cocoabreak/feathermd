import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkPreviewStore, type LinkPreviewReadResponse } from "./link-preview.svelte";

const current = { sourceId: "source", path: "current.md" };
const target = { sourceId: "source", path: "target.md" };
const rect = () => ({ top: 10, right: 110, bottom: 30, left: 10, width: 100, height: 20 });

describe("LinkPreviewStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("450ms未満の離脱では読み込まない", async () => {
    const reader = vi.fn<() => Promise<LinkPreviewReadResponse>>();
    const store = new LinkPreviewStore(reader);
    store.begin({ current, target, sourceGeneration: 1, anchor: null, getRect: rect });
    await vi.advanceTimersByTimeAsync(449);
    store.hide(0);
    await vi.runAllTimersAsync();
    expect(reader).not.toHaveBeenCalled();
    expect(store.status).toBe("idle");
  });

  it("古い応答を破棄し最新の対象だけを表示する", async () => {
    let resolveFirst!: (value: LinkPreviewReadResponse) => void;
    const reader = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<LinkPreviewReadResponse>((resolve) => (resolveFirst = resolve))
      )
      .mockResolvedValueOnce({
        status: "ready",
        rawPrefix: "# Second\nnew",
        byteSize: 12,
        truncated: false,
        sourceGeneration: 1,
      });
    const store = new LinkPreviewStore(reader);
    store.begin({ current, target, sourceGeneration: 1, anchor: null, getRect: rect }, 0);
    await vi.runOnlyPendingTimersAsync();
    store.begin(
      {
        current,
        target: { ...target, path: "second.md" },
        sourceGeneration: 1,
        anchor: null,
        getRect: rect,
      },
      0
    );
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    resolveFirst({
      status: "ready",
      rawPrefix: "# First\nold",
      byteSize: 11,
      truncated: false,
      sourceGeneration: 1,
    });
    await Promise.resolve();
    expect(store.content?.path).toBe("second.md");
    expect(store.content?.excerpt).toBe("new");
  });

  it("リンク切れはreaderを呼ばず表示する", async () => {
    const reader = vi.fn<() => Promise<LinkPreviewReadResponse>>();
    const store = new LinkPreviewStore(reader);
    store.beginMissing("missing.md", rect, 0);
    await vi.runAllTimersAsync();
    expect(store.status).toBe("missing");
    expect(reader).not.toHaveBeenCalled();
  });

  it("Source generation不一致の応答を表示しない", async () => {
    const store = new LinkPreviewStore(async () => ({
      status: "ready",
      rawPrefix: "stale",
      byteSize: 5,
      truncated: false,
      sourceGeneration: 2,
    }));
    store.begin({ current, target, sourceGeneration: 1, anchor: null, getRect: rect }, 0);
    await vi.runAllTimersAsync();
    expect(store.status).toBe("idle");
  });

  it("150msの離脱猶予後に閉じる", async () => {
    const store = new LinkPreviewStore(async () => ({
      status: "ready",
      rawPrefix: "# Target",
      byteSize: 8,
      truncated: false,
      sourceGeneration: 1,
    }));
    store.begin({ current, target, sourceGeneration: 1, anchor: null, getRect: rect }, 0);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    store.hide();
    await vi.advanceTimersByTimeAsync(149);
    expect(store.visible).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.status).toBe("idle");
  });

  it("キャッシュを32件に制限しSource無効化後は再読込する", async () => {
    const reader = vi.fn(
      async (_current: typeof current, next: typeof target): Promise<LinkPreviewReadResponse> => ({
        status: "ready",
        rawPrefix: `# ${next.path}`,
        byteSize: next.path.length + 2,
        truncated: false,
        sourceGeneration: 1,
      })
    );
    const store = new LinkPreviewStore(reader);
    const show = async (path: string) => {
      store.begin(
        {
          current,
          target: { ...target, path },
          sourceGeneration: 1,
          anchor: null,
          getRect: rect,
        },
        0
      );
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    };

    for (let index = 0; index < 33; index++) await show(`target-${index}.md`);
    expect(reader).toHaveBeenCalledTimes(33);
    await show("target-0.md");
    expect(reader).toHaveBeenCalledTimes(34);
    await show("target-32.md");
    expect(reader).toHaveBeenCalledTimes(34);

    store.invalidateSource("source");
    await show("target-32.md");
    expect(reader).toHaveBeenCalledTimes(35);
  });
});
