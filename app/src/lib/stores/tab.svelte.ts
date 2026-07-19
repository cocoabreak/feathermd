import { invoke } from "@tauri-apps/api/core";
import { contentStore } from "$lib/stores/content.svelte";
import type { Tab } from "$lib/types";
import {
  nativeDocumentIdentity,
  nativeDocumentPath,
  nativePathsEqual,
} from "$lib/document-sources";
import { explorerStore } from "$lib/stores/explorer.svelte";
import { sessionUiStateStore } from "$lib/stores/session-ui-state.svelte";

const MAX_RECENTLY_CLOSED_TABS = 10;

export interface ClosedTabEntry {
  tab: Tab;
  index: number;
}

function copyTab(tab: Tab): Tab {
  return {
    ...tab,
    document: tab.document ? { ...tab.document } : undefined,
    source: tab.source
      ? { ...tab.source, capabilities: { ...tab.source.capabilities } }
      : undefined,
  };
}

function representsSameDocument(left: Tab, right: Tab): boolean {
  if (left.path === right.path) return true;
  if (!left.document || !left.source || !right.document || !right.source) return false;
  const leftNative = nativeDocumentIdentity(left.source, left.document);
  if (leftNative !== null) {
    return leftNative === nativeDocumentIdentity(right.source, right.document);
  }
  return (
    left.source.kind === "zip" &&
    right.source.kind === "zip" &&
    nativePathsEqual(left.source.nativePath, right.source.nativePath) &&
    left.document.path === right.document.path
  );
}

export function createTabStore() {
  let tabs = $state<Tab[]>([]);
  let activeTabId = $state<string | null>(null);
  let recentlyClosed = $state<ClosedTabEntry[]>([]);
  const closingIds = new Set<string>();
  const pendingCloseOperations = new Set<Promise<void>>();

  function rememberClosed(tab: Tab, index: number) {
    recentlyClosed = [
      ...recentlyClosed.slice(-(MAX_RECENTLY_CLOSED_TABS - 1)),
      { tab: copyTab(tab), index },
    ];
  }

  function closeTab(id: string): boolean {
    const target = tabs.find((tab) => tab.id === id);
    if (!target || target.pinned) return false;
    const index = tabs.findIndex((tab) => tab.id === id);
    tabs = tabs.filter((tab) => tab.id !== id);
    sessionUiStateStore.deleteTab(id);
    if (activeTabId === id) {
      activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
    }
    return true;
  }

  async function performCloseAndUnwatch(id: string): Promise<void> {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab || tab.pinned || closingIds.has(id)) return;
    closingIds.add(id);
    const index = tabs.findIndex((candidate) => candidate.id === id);
    try {
      if (tab.document && tab.source) {
        const nativePath = nativeDocumentPath(tab.source, tab.document);
        const identity = nativeDocumentIdentity(tab.source, tab.document);
        const usedByAnotherTab =
          identity !== null &&
          tabs.some(
            (candidate) =>
              candidate.id !== id &&
              !!candidate.document &&
              !!candidate.source &&
              nativeDocumentIdentity(candidate.source, candidate.document) === identity
          );
        if (nativePath && !usedByAnotherTab) {
          await invoke("unwatch_path", { path: nativePath }).catch(() => {});
        }
      }
      if (!closeTab(id)) return;
      contentStore.delete(tab.path);
      if (
        tab.source?.kind === "zip" &&
        explorerStore.source?.id !== tab.source.id &&
        !tabs.some((candidate) => candidate.source?.id === tab.source?.id)
      ) {
        await invoke("unwatch_path", { path: tab.source.nativePath }).catch(() => {});
        await invoke("unregister_source", { sourceId: tab.source.id }).catch(() => {});
      }
      rememberClosed(tab, index);
    } finally {
      closingIds.delete(id);
    }
  }

  function closeAndUnwatch(id: string): Promise<void> {
    const operation = performCloseAndUnwatch(id);
    pendingCloseOperations.add(operation);
    void operation.then(
      () => pendingCloseOperations.delete(operation),
      () => pendingCloseOperations.delete(operation)
    );
    return operation;
  }

  return {
    get tabs() {
      return tabs;
    },
    get activeTabId() {
      return activeTabId;
    },
    get canReopenClosedTab() {
      return recentlyClosed.length > 0;
    },
    addOrActivate(tab: Tab) {
      recentlyClosed = recentlyClosed.filter((entry) => !representsSameDocument(entry.tab, tab));
      const existing = tabs.find((t) => t.path === tab.path);
      if (existing) {
        activeTabId = existing.id;
      } else {
        if (tab.pinned) {
          const firstUnpinned = tabs.findIndex((candidate) => !candidate.pinned);
          const index = firstUnpinned === -1 ? tabs.length : firstUnpinned;
          tabs = [...tabs.slice(0, index), tab, ...tabs.slice(index)];
        } else {
          tabs = [...tabs, tab];
        }
        activeTabId = tab.id;
      }
    },
    close: closeTab,
    setActive(id: string) {
      activeTabId = id;
    },
    togglePin(id: string) {
      if (closingIds.has(id)) return;
      const tab = tabs.find((candidate) => candidate.id === id);
      if (!tab) return;
      const next = tabs.filter((candidate) => candidate.id !== id);
      const updated = { ...tab, pinned: !tab.pinned };
      const firstUnpinned = next.findIndex((candidate) => !candidate.pinned);
      const index = firstUnpinned === -1 ? next.length : firstUnpinned;
      next.splice(index, 0, updated);
      tabs = next;
    },
    moveRelative(id: string, targetId: string, position: "before" | "after") {
      if (id === targetId) return;
      const tab = tabs.find((candidate) => candidate.id === id);
      const target = tabs.find((candidate) => candidate.id === targetId);
      if (!tab || !target || !!tab.pinned !== !!target.pinned) return;
      const next = tabs.filter((candidate) => candidate.id !== id);
      const targetIndex = next.findIndex((candidate) => candidate.id === targetId);
      next.splice(targetIndex + (position === "after" ? 1 : 0), 0, tab);
      tabs = next;
    },
    moveToIndex(id: string, requestedIndex: number) {
      const tab = tabs.find((candidate) => candidate.id === id);
      if (!tab || !Number.isInteger(requestedIndex)) return;
      const next = tabs.filter((candidate) => candidate.id !== id);
      const pinnedCount = next.filter((candidate) => candidate.pinned).length;
      const min = tab.pinned ? 0 : pinnedCount;
      const max = tab.pinned ? pinnedCount : next.length;
      const index = Math.max(min, Math.min(requestedIndex, max));
      next.splice(index, 0, tab);
      tabs = next;
    },
    updateTab(id: string, updates: Partial<Tab>) {
      tabs = tabs.map((t) => (t.id === id ? { ...t, ...updates } : t));
    },
    cycle(direction: 1 | -1) {
      if (tabs.length === 0) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      const nextIdx = (idx + direction + tabs.length) % tabs.length;
      activeTabId = tabs[nextIdx].id;
    },
    jumpTo(index: number) {
      const tab = tabs[index];
      if (tab) activeTabId = tab.id;
    },
    takeRecentlyClosed(): ClosedTabEntry | undefined {
      const entry = recentlyClosed.at(-1);
      if (entry) recentlyClosed = recentlyClosed.slice(0, -1);
      return entry;
    },
    clearRecentlyClosed() {
      recentlyClosed = [];
    },
    closeAndUnwatch,
    async waitForCloseOperations() {
      while (pendingCloseOperations.size > 0) {
        await Promise.allSettled([...pendingCloseOperations]);
      }
    },
    async closeOthers(id: string) {
      const ids = tabs
        .filter((candidate) => candidate.id !== id && !candidate.pinned)
        .map((candidate) => candidate.id)
        .reverse();
      for (const candidateId of ids) await closeAndUnwatch(candidateId);
    },
    async closeToRight(id: string) {
      const index = tabs.findIndex((candidate) => candidate.id === id);
      if (index === -1) return;
      const ids = tabs
        .slice(index + 1)
        .filter((candidate) => !candidate.pinned)
        .map((candidate) => candidate.id)
        .reverse();
      for (const candidateId of ids) await closeAndUnwatch(candidateId);
    },
  };
}

export const tabStore = createTabStore();
