import { describe, it, expect, beforeEach } from "vitest";
import { createHistoryStore } from "./history.svelte";

describe("historyStore", () => {
  let store: ReturnType<typeof createHistoryStore>;

  beforeEach(() => {
    store = createHistoryStore();
  });

  it("recordで末尾に追加されindexが追従する", () => {
    store.record("/a.md");
    store.record("/b.md");
    expect(store.entries).toEqual(["/a.md", "/b.md"]);
    expect(store.index).toBe(1);
    expect(store.canGoBack).toBe(true);
    expect(store.canGoForward).toBe(false);
  });

  it("現在位置と同じパスのrecordは無視される（連続重複排除）", () => {
    store.record("/a.md");
    store.record("/a.md");
    expect(store.entries).toEqual(["/a.md"]);
  });

  it("戻った状態でrecordすると進む側の履歴が破棄される", () => {
    store.record("/a.md");
    store.record("/b.md");
    store.record("/c.md");
    store.step(-1); // → b
    store.record("/d.md");
    expect(store.entries).toEqual(["/a.md", "/b.md", "/d.md"]);
    expect(store.index).toBe(2);
  });

  it("戻った先と同じパスのrecordは無視され進む履歴も保持される", () => {
    store.record("/a.md");
    store.record("/b.md");
    store.step(-1); // → a
    store.record("/a.md"); // 戻る/進むによる切替でeffectが発火したケース
    expect(store.entries).toEqual(["/a.md", "/b.md"]);
    expect(store.index).toBe(0);
    expect(store.canGoForward).toBe(true);
  });

  it("stepで戻る/進むができ、端ではnullを返して動かない", () => {
    store.record("/a.md");
    store.record("/b.md");
    expect(store.step(-1)).toBe("/a.md");
    expect(store.step(-1)).toBeNull();
    expect(store.index).toBe(0);
    expect(store.step(1)).toBe("/b.md");
    expect(store.step(1)).toBeNull();
    expect(store.index).toBe(1);
  });

  it("空の履歴でstepしてもnullを返す", () => {
    expect(store.step(-1)).toBeNull();
    expect(store.step(1)).toBeNull();
  });

  it("上限50件を超えると古いものから捨てられる", () => {
    for (let i = 0; i < 60; i++) {
      store.record(`/f${i}.md`);
    }
    expect(store.entries.length).toBe(50);
    expect(store.entries[0]).toBe("/f10.md");
    expect(store.entries[49]).toBe("/f59.md");
    expect(store.index).toBe(49);
  });

  it("dropCurrent(-1)で除去後、同方向のstepが次の古いエントリを指す", () => {
    store.record("/a.md");
    store.record("/b.md");
    store.record("/c.md");
    expect(store.step(-1)).toBe("/b.md"); // bが開けなかった想定
    store.dropCurrent(-1);
    expect(store.entries).toEqual(["/a.md", "/c.md"]);
    expect(store.step(-1)).toBe("/a.md");
  });

  it("dropCurrent(1)で除去後、同方向のstepが次の新しいエントリを指す", () => {
    store.record("/a.md");
    store.record("/b.md");
    store.record("/c.md");
    store.step(-1);
    store.step(-1); // → a
    expect(store.step(1)).toBe("/b.md"); // bが開けなかった想定
    store.dropCurrent(1);
    expect(store.entries).toEqual(["/a.md", "/c.md"]);
    expect(store.step(1)).toBe("/c.md");
  });

  it("dropCurrentで先頭エントリを除去するとそれ以上戻れない", () => {
    store.record("/a.md");
    store.record("/b.md");
    store.step(-1); // → a
    store.dropCurrent(-1);
    expect(store.entries).toEqual(["/b.md"]);
    expect(store.step(-1)).toBeNull();
  });

  it("replaceCurrentはソース再登録後の新しいDocumentRefキーへ現在位置だけを更新する", () => {
    const store = createHistoryStore();
    store.record("source-1:README.md");
    store.record("native:note.md");
    expect(store.step(-1)).toBe("source-1:README.md");

    store.replaceCurrent("source-2:README.md");

    expect(store.entries).toEqual(["source-2:README.md", "native:note.md"]);
    expect(store.index).toBe(0);
  });
});
