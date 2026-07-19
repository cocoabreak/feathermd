import { beforeEach, describe, expect, it, vi } from "vitest";
import { LatestSaveQueue } from "./state-save-queue";

describe("LatestSaveQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("debounce中のsnapshotを最新値へ集約する", async () => {
    const persist = vi.fn(async () => {});
    const queue = new LatestSaveQueue(persist, 200);
    void queue.enqueue(1);
    void queue.enqueue(2);
    const latest = queue.enqueue(3);
    await vi.advanceTimersByTimeAsync(200);
    await latest;
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(3);
  });

  it("保存中の更新も最新値を最後に直列保存する", async () => {
    let releaseFirst: (() => void) | undefined;
    const persist = vi.fn((value: number) =>
      value === 1 ? new Promise<void>((resolve) => (releaseFirst = resolve)) : Promise.resolve()
    );
    const queue = new LatestSaveQueue(persist, 0);
    void queue.enqueue(1);
    await vi.advanceTimersByTimeAsync(0);
    void queue.enqueue(2);
    const latest = queue.enqueue(3);
    releaseFirst?.();
    await latest;
    expect(persist.mock.calls.map(([value]) => value)).toEqual([1, 3]);
  });

  it("flushはdebounceを待たずに保存する", async () => {
    const persist = vi.fn(async () => {});
    const queue = new LatestSaveQueue(persist, 10_000);
    void queue.enqueue("latest");
    await queue.flush();
    expect(persist).toHaveBeenCalledWith("latest");
  });

  it("先行保存が失敗しても保存中に届いた最新snapshotの成否へ収束する", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    const persist = vi.fn((value: number) =>
      value === 1
        ? new Promise<void>((_, reject) => {
            rejectFirst = reject;
          })
        : Promise.resolve()
    );
    const queue = new LatestSaveQueue(persist, 0);
    void queue.enqueue(1).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const latest = queue.enqueue(2);
    rejectFirst?.(new Error("first failed"));

    await expect(latest).resolves.toBeUndefined();
    expect(persist.mock.calls.map(([value]) => value)).toEqual([1, 2]);
  });

  it("最新snapshotの保存失敗は呼び出し元へ返す", async () => {
    const queue = new LatestSaveQueue(async () => {
      throw new Error("save failed");
    }, 0);
    const latest = queue.enqueue("latest");
    const rejection = expect(latest).rejects.toThrow("save failed");
    await vi.advanceTimersByTimeAsync(0);
    await rejection;
  });
});
