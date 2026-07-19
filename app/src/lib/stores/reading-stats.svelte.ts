import type { ReadingStats } from "$lib/markdown/reading-stats";

function createReadingStatsStore() {
  let stats = $state<ReadingStats | null>(null);

  return {
    get stats() {
      return stats;
    },
    set(value: ReadingStats | null) {
      stats = value;
    },
  };
}

export const readingStatsStore = createReadingStatsStore();
