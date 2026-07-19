import type { DocumentRef, DocumentSourceInfo, FileEntry } from "$lib/types";

/** ツリーからpathに一致するエントリを深さ優先で探す */
function findEntry(entries: FileEntry[], path: string): FileEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.children) {
      const found = findEntry(entry.children, path);
      if (found) return found;
    }
  }
  return null;
}

/** 新エントリに旧エントリの読み込み済みchildrenを引き継ぐ（展開中の孫ツリーを維持する） */
function inheritChildren(newEntries: FileEntry[], oldEntries: FileEntry[]): FileEntry[] {
  const oldByPath = new Map(oldEntries.map((e) => [e.path, e]));
  for (const entry of newEntries) {
    const old = oldByPath.get(entry.path);
    if (entry.isDir && old?.children) {
      entry.children = old.children;
    }
  }
  return newEntries;
}

/** entries配下の全ディレクトリパスを収集する（自身は含まない） */
function collectDirPaths(entries: FileEntry[], into: Set<string>): void {
  for (const entry of entries) {
    if (entry.isDir) {
      into.add(entry.path);
      if (entry.children) collectDirPaths(entry.children, into);
    }
  }
}

function createExplorerStore() {
  let rootPath = $state<string | null>(null);
  let source = $state<DocumentSourceInfo | null>(null);
  let rootDocument = $state<DocumentRef | null>(null);
  let tree = $state<FileEntry[]>([]);
  let expandedDirs = $state<Set<string>>(new Set());
  let loadingDirs = $state<Set<string>>(new Set());

  return {
    get rootPath() {
      return rootPath;
    },
    get source() {
      return source;
    },
    get rootDocument() {
      return rootDocument;
    },
    get tree() {
      return tree;
    },
    get expandedDirs() {
      return expandedDirs;
    },
    get loadingDirs() {
      return loadingDirs;
    },
    getEntry(path: string) {
      return findEntry(tree, path);
    },
    setRoot(path: string, entries: FileEntry[], sourceInfo?: DocumentSourceInfo) {
      rootPath = path;
      source = sourceInfo ?? null;
      rootDocument = sourceInfo ? { sourceId: sourceInfo.id, path: "" } : null;
      tree = entries;
      expandedDirs = new Set();
      loadingDirs = new Set();
    },
    clear() {
      rootPath = null;
      source = null;
      rootDocument = null;
      tree = [];
      expandedDirs = new Set();
      loadingDirs = new Set();
    },
    updateSource(sourceInfo: DocumentSourceInfo) {
      if (source?.id === sourceInfo.id) {
        source = sourceInfo;
        rootDocument = { sourceId: sourceInfo.id, path: "" };
      }
    },
    /** 遅延読み込みで取得した子エントリをツリー内の該当ディレクトリへ差し込む */
    setChildren(path: string, children: FileEntry[]) {
      const entry = findEntry(tree, path);
      if (entry) {
        entry.children = children;
      }
    },
    /**
     * 再取得した1階層分のエントリで該当レベルを差し替える。
     * 残存するディレクトリは読み込み済みchildrenを引き継ぎ、消えたディレクトリは
     * 展開状態・読み込み中状態を後始末する。pathがルートのときはツリー自体を差し替える。
     */
    mergeLevel(path: string, newEntries: FileEntry[]) {
      const oldEntries = path === rootPath ? tree : (findEntry(tree, path)?.children ?? null);
      if (oldEntries === null) return;

      const before = new Set<string>();
      collectDirPaths(oldEntries, before);
      const merged = inheritChildren(newEntries, oldEntries);
      const after = new Set<string>();
      collectDirPaths(merged, after);

      if (path === rootPath) {
        tree = merged;
      } else {
        const entry = findEntry(tree, path);
        if (entry) entry.children = merged;
      }

      // 消えたディレクトリ（子孫含む）の展開・読み込み状態を除去する
      const removed = [...before].filter((p) => !after.has(p));
      if (removed.length > 0) {
        const nextExpanded = new Set(expandedDirs);
        const nextLoading = new Set(loadingDirs);
        for (const p of removed) {
          nextExpanded.delete(p);
          nextLoading.delete(p);
        }
        expandedDirs = nextExpanded;
        loadingDirs = nextLoading;
      }
    },
    setDirLoading(path: string, loading: boolean) {
      const next = new Set(loadingDirs);
      if (loading) {
        next.add(path);
      } else {
        next.delete(path);
      }
      loadingDirs = next;
    },
    toggleDir(path: string) {
      const next = new Set(expandedDirs);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      expandedDirs = next;
    },
    expandDir(path: string) {
      if (expandedDirs.has(path)) return;
      expandedDirs = new Set([...expandedDirs, path]);
    },
  };
}

export const explorerStore = createExplorerStore();
