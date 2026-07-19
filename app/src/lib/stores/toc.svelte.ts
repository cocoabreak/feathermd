import type { TocHeading } from "$lib/types";

function createTocStore() {
  let headings = $state<TocHeading[]>([]);
  let activeId = $state<string | null>(null);
  let truncated = $state(false);

  return {
    get headings() {
      return headings;
    },
    get activeId() {
      return activeId;
    },
    get truncated() {
      return truncated;
    },
    setHeadings(h: TocHeading[]) {
      headings = h;
      truncated = false;
    },
    setSafeOutline(h: TocHeading[], isTruncated: boolean) {
      headings = h;
      truncated = isTruncated;
    },
    setActiveId(id: string | null) {
      activeId = id;
    },
  };
}

export const tocStore = createTocStore();
