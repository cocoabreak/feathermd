import type { SafeOutlineHeading } from "$lib/types";

export interface FileContent {
  raw: string;
  safeOutline: SafeOutlineHeading[];
  safeOutlineTruncated: boolean;
}

function createContentStore() {
  let cache = $state<Map<string, FileContent>>(new Map());

  return {
    get(path: string): FileContent | undefined {
      return cache.get(path);
    },
    set(path: string, content: FileContent) {
      cache = new Map(cache).set(path, content);
    },
    delete(path: string) {
      const next = new Map(cache);
      next.delete(path);
      cache = next;
    },
  };
}

export const contentStore = createContentStore();
