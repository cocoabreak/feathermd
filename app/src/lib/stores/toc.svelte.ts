import type { TocHeading } from "$lib/types";
import { headingBaseId, uniqueHeadingId } from "$lib/markdown/heading-anchor";

export function withReferenceHeadingIds(headings: TocHeading[]): TocHeading[] {
  const usedIds = new Set<string>();
  return headings.map((heading, index) => {
    const referenceId = uniqueHeadingId(
      headingBaseId(heading.anchorText ?? heading.text, index),
      usedIds
    );
    usedIds.add(referenceId);
    return { ...heading, referenceId };
  });
}

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
      headings = withReferenceHeadingIds(h);
      truncated = isTruncated;
    },
    setActiveId(id: string | null) {
      activeId = id;
    },
  };
}

export const tocStore = createTocStore();
