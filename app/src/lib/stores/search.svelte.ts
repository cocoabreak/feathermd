import type { SearchResultItem } from "$lib/markdown/search-results";

export interface PersistedSearchState {
  open: boolean;
  query: string;
  useRegex: boolean;
}

const MAX_PERSISTED_QUERY_LENGTH = 10_000;

function createSearchStore() {
  let open = $state(false);
  let query = $state("");
  let useRegex = $state(false);
  let matchCount = $state(0);
  let currentIndex = $state(-1); // -1 = マッチなし
  let error = $state<string | null>(null);
  let truncated = $state(false);
  let results = $state<SearchResultItem[]>([]);
  let resultsTruncated = $state(false);
  let selectedResultIndex = $state(-1);
  let resultSelectionVersion = $state(0);
  let selectedResultLine = $state<number | null>(null);
  let targetLine = $state<number | null>(null);
  // next/prevによる「ユーザーが明示的にジャンプを求めた」ことを表すカウンタ。
  // setResult()によるcurrentIndexのリセット（再走査時）と区別するために使う。
  // currentIndexの値だけでは、たまたま同じ値になる再走査由来の変化と
  // 実際のユーザー操作を区別できないため。
  let navVersion = $state(0);

  return {
    get open() {
      return open;
    },
    get query() {
      return query;
    },
    get useRegex() {
      return useRegex;
    },
    get matchCount() {
      return matchCount;
    },
    get currentIndex() {
      return currentIndex;
    },
    get error() {
      return error;
    },
    get truncated() {
      return truncated;
    },
    get results() {
      return results;
    },
    get resultsTruncated() {
      return resultsTruncated;
    },
    get selectedResultIndex() {
      return selectedResultIndex;
    },
    get resultSelectionVersion() {
      return resultSelectionVersion;
    },
    get selectedResultLine() {
      return selectedResultLine;
    },
    get navVersion() {
      return navVersion;
    },
    get targetLine() {
      return targetLine;
    },
    get sessionState(): PersistedSearchState {
      return { open, query, useRegex };
    },
    openSearch() {
      open = true;
    },
    closeSearch() {
      // queryは残す（再度Ctrl+Fで開いたときに前回検索語を再利用できる）
      open = false;
      matchCount = 0;
      currentIndex = -1;
      error = null;
      truncated = false;
      results = [];
      resultsTruncated = false;
      selectedResultIndex = -1;
      selectedResultLine = null;
      targetLine = null;
    },
    setQuery(q: string) {
      query = q;
    },
    setTargetLine(line: number | null) {
      targetLine = line;
    },
    selectResult(index: number, line: number) {
      selectedResultIndex = index;
      selectedResultLine = line;
      resultSelectionVersion++;
    },
    clearSelectedResultLine() {
      selectedResultLine = null;
    },
    setCurrentIndex(index: number) {
      currentIndex = index;
      navVersion++;
    },
    toggleRegex() {
      useRegex = !useRegex;
    },
    setRegex(value: boolean) {
      useRegex = value;
    },
    restoreSessionState(value: unknown) {
      const candidate =
        value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      open = candidate.open === true;
      query =
        typeof candidate.query === "string"
          ? candidate.query.slice(0, MAX_PERSISTED_QUERY_LENGTH)
          : "";
      useRegex = candidate.useRegex === true;
      matchCount = 0;
      currentIndex = -1;
      error = null;
      truncated = false;
      results = [];
      resultsTruncated = false;
      selectedResultIndex = -1;
      selectedResultLine = null;
      targetLine = null;
    },
    setResult(count: number, err: string | null, wasTruncated = false) {
      matchCount = count;
      error = err;
      truncated = wasTruncated;
      currentIndex = count > 0 ? 0 : -1;
    },
    setResults(items: SearchResultItem[], wasTruncated: boolean) {
      results = items;
      resultsTruncated = wasTruncated;
      selectedResultIndex = -1;
    },
    next() {
      if (matchCount === 0) return;
      currentIndex = (currentIndex + 1) % matchCount;
      selectedResultIndex = -1;
      navVersion++;
    },
    prev() {
      if (matchCount === 0) return;
      currentIndex = (currentIndex - 1 + matchCount) % matchCount;
      selectedResultIndex = -1;
      navVersion++;
    },
  };
}

export const searchStore = createSearchStore();
