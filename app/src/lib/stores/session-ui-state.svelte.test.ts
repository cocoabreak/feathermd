import { describe, expect, it, vi } from "vitest";
import {
  createSessionUiStateStore,
  sanitizeScrollPositions,
  shouldRestoreScroll,
} from "./session-ui-state.svelte";

describe("sessionUiStateStore", () => {
  it("表示モードごとのスクロール位置を保持する", () => {
    const store = createSessionUiStateStore();
    store.setScroll("tab-a", "rendered", 120);
    store.setScroll("tab-a", "source", 45);

    expect(store.getScroll("tab-a", "rendered")).toBe(120);
    expect(store.snapshot("tab-a")).toEqual({ rendered: 120, source: 45 });
  });

  it("復元値から非有限数と負数を除外する", () => {
    expect(
      sanitizeScrollPositions({ rendered: 30, source: -1, safe: Number.POSITIVE_INFINITY })
    ).toEqual({ rendered: 30 });
  });

  it("復元した位置を新しいタブIDへ結び直せる", () => {
    const store = createSessionUiStateStore();
    store.restoreScrollPositions("new-tab-id", { rendered: 250, safe: 12 });

    expect(store.getScroll("new-tab-id", "rendered")).toBe(250);
    expect(store.getScroll("new-tab-id", "safe")).toBe(12);
  });

  it("タブ削除時に位置も破棄する", () => {
    const store = createSessionUiStateStore();
    store.setScroll("tab-a", "rendered", 10);
    store.deleteTab("tab-a");

    expect(store.snapshot("tab-a")).toEqual({});
  });

  it("連続スクロールの保存通知を操作停止後の1回にまとめる", () => {
    vi.useFakeTimers();
    try {
      const store = createSessionUiStateStore();
      store.setScroll("tab-a", "rendered", 10);
      store.setScroll("tab-a", "rendered", 20);
      store.setScroll("tab-a", "rendered", 30);
      expect(store.version).toBe(0);

      vi.advanceTimersByTime(199);
      expect(store.version).toBe(0);
      vi.advanceTimersByTime(1);
      expect(store.version).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("同じ表示キーでも復元値が後から設定された場合は再適用する", () => {
    expect(shouldRestoreScroll("tab-a:safe", "tab-a:safe", true)).toBe(true);
    expect(shouldRestoreScroll("tab-a:safe", "tab-a:safe", false)).toBe(false);
  });
});
