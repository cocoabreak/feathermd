import { basename } from "$lib/utils";

export interface RecentEntry {
  path: string;
  title: string;
}

const MAX_RECENT = 10;

function toEntry(path: string): RecentEntry {
  return { path, title: basename(path) };
}

function pushRecent(list: RecentEntry[], path: string): RecentEntry[] {
  const filtered = list.filter((e) => e.path !== path);
  return [toEntry(path), ...filtered].slice(0, MAX_RECENT);
}

function createRecentStore() {
  let files = $state<RecentEntry[]>([]);
  let folders = $state<RecentEntry[]>([]);
  let archives = $state<RecentEntry[]>([]);

  return {
    get files() {
      return files;
    },
    get folders() {
      return folders;
    },
    get archives() {
      return archives;
    },
    addFile(path: string) {
      files = pushRecent(files, path);
    },
    addFolder(path: string) {
      folders = pushRecent(folders, path);
    },
    addArchive(path: string) {
      archives = pushRecent(archives, path);
    },
    removeFile(path: string) {
      files = files.filter((entry) => entry.path !== path);
    },
    removeFolder(path: string) {
      folders = folders.filter((entry) => entry.path !== path);
    },
    removeArchive(path: string) {
      archives = archives.filter((entry) => entry.path !== path);
    },
    setAll(data: { files: RecentEntry[]; folders: RecentEntry[]; archives?: RecentEntry[] }) {
      files = data.files;
      folders = data.folders;
      archives = data.archives ?? [];
    },
  };
}

export const recentStore = createRecentStore();
