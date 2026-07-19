import { describe, it, expect, beforeEach } from "vitest";
import { searchStore } from "./search.svelte";

describe("searchStore", () => {
  beforeEach(() => {
    searchStore.closeSearch();
    searchStore.setQuery("");
  });

  it("openSearch は open を true にする", () => {
    searchStore.openSearch();
    expect(searchStore.open).toBe(true);
  });

  it("closeSearch は query を保持したまま open/matchCount/currentIndex/error をリセットする", () => {
    searchStore.setQuery("hello");
    searchStore.setResult(3, null);
    searchStore.openSearch();

    searchStore.closeSearch();

    expect(searchStore.open).toBe(false);
    expect(searchStore.query).toBe("hello");
    expect(searchStore.matchCount).toBe(0);
    expect(searchStore.currentIndex).toBe(-1);
    expect(searchStore.error).toBeNull();
    expect(searchStore.results).toEqual([]);
  });

  it("setResult はマッチがあればcurrentIndexを0にする", () => {
    searchStore.setResult(5, null);
    expect(searchStore.matchCount).toBe(5);
    expect(searchStore.currentIndex).toBe(0);
  });

  it("setResult はマッチが0件ならcurrentIndexを-1にする", () => {
    searchStore.setResult(0, null);
    expect(searchStore.currentIndex).toBe(-1);
  });

  it("next はマッチ件数をまたいでループする", () => {
    searchStore.setResult(3, null);
    expect(searchStore.currentIndex).toBe(0);
    searchStore.next();
    expect(searchStore.currentIndex).toBe(1);
    searchStore.next();
    expect(searchStore.currentIndex).toBe(2);
    searchStore.next();
    expect(searchStore.currentIndex).toBe(0);
  });

  it("prev はマッチ件数をまたいでループする", () => {
    searchStore.setResult(3, null);
    expect(searchStore.currentIndex).toBe(0);
    searchStore.prev();
    expect(searchStore.currentIndex).toBe(2);
  });

  it("next/prev はマッチ0件のとき何もしない", () => {
    searchStore.setResult(0, null);
    searchStore.next();
    expect(searchStore.currentIndex).toBe(-1);
    searchStore.prev();
    expect(searchStore.currentIndex).toBe(-1);
  });

  it("next/prev は navVersion を増分し、setResult は増分しない", () => {
    searchStore.setResult(3, null);
    const afterResult = searchStore.navVersion;

    searchStore.next();
    expect(searchStore.navVersion).toBe(afterResult + 1);

    searchStore.prev();
    expect(searchStore.navVersion).toBe(afterResult + 2);

    searchStore.setResult(3, null);
    expect(searchStore.navVersion).toBe(afterResult + 2);
  });

  it("toggleRegex は useRegex を反転する", () => {
    expect(searchStore.useRegex).toBe(false);
    searchStore.toggleRegex();
    expect(searchStore.useRegex).toBe(true);
    searchStore.toggleRegex();
    expect(searchStore.useRegex).toBe(false);
  });

  it("検索結果一覧と打切り状態を保持する", () => {
    const items = [{ line: 3, before: "a", match: "b", after: "c" }];
    searchStore.setResults(items, true);
    expect(searchStore.results).toEqual(items);
    expect(searchStore.resultsTruncated).toBe(true);

    const version = searchStore.resultSelectionVersion;
    searchStore.selectResult(0, 3);
    expect(searchStore.selectedResultIndex).toBe(0);
    expect(searchStore.selectedResultLine).toBe(3);
    expect(searchStore.resultSelectionVersion).toBe(version + 1);
  });

  it("保存対象の検索状態だけを復元し、派生結果を初期化する", () => {
    searchStore.setResult(3, null);
    searchStore.setResults([{ line: 1, before: "", match: "hit", after: "" }], false);

    searchStore.restoreSessionState({ open: true, query: "restored", useRegex: true });

    expect(searchStore.sessionState).toEqual({ open: true, query: "restored", useRegex: true });
    expect(searchStore.matchCount).toBe(0);
    expect(searchStore.currentIndex).toBe(-1);
    expect(searchStore.results).toEqual([]);
  });
});
