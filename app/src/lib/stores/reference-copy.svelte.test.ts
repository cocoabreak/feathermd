import { afterEach, describe, expect, it, vi } from "vitest";
import { createReferenceCopyFeedbackStore } from "./reference-copy.svelte";

afterEach(() => {
  vi.useRealTimers();
});

describe("reference copy feedback store", () => {
  it("連続通知ではタイマーを更新し、最後の通知を自動消去する", () => {
    vi.useFakeTimers();
    const store = createReferenceCopyFeedbackStore();
    store.show("success", "copied");
    vi.advanceTimersByTime(1500);
    store.show("error", "failed");
    vi.advanceTimersByTime(600);
    expect(store.feedback).toEqual({ kind: "error", message: "failed" });
    vi.advanceTimersByTime(1400);
    expect(store.feedback).toBeNull();
  });
});
