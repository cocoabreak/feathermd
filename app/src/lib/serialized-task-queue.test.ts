import { describe, expect, it } from "vitest";
import { SerializedTaskQueue } from "./serialized-task-queue";

describe("SerializedTaskQueue", () => {
  it("同じsourceの後続reloadを先行reloadの完了後に開始する", async () => {
    const queue = new SerializedTaskQueue<string>();
    const events: string[] = [];
    let finishFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });

    const first = queue.enqueue("source-1", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = queue.enqueue("source-1", async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("先行reloadが失敗しても後続reloadを実行する", async () => {
    const queue = new SerializedTaskQueue<string>();
    const events: string[] = [];
    const first = queue.enqueue("source-1", async () => {
      events.push("first");
      throw new Error("reload failed");
    });
    const second = queue.enqueue("source-1", async () => {
      events.push("second");
    });

    await expect(first).rejects.toThrow("reload failed");
    await second;
    expect(events).toEqual(["first", "second"]);
  });
});
