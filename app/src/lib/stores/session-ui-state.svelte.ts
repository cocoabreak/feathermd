export type ScrollViewMode = "rendered" | "source" | "safe";

export interface ScrollPositions {
  rendered?: number;
  source?: number;
  safe?: number;
}

export function shouldRestoreScroll(
  viewKey: string | null,
  previousViewKey: string | null,
  restoredPositionsChanged: boolean
): boolean {
  return viewKey !== previousViewKey || restoredPositionsChanged;
}

function validScrollPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function sanitizeScrollPositions(value: unknown): ScrollPositions {
  if (!value || typeof value !== "object") return {};
  const candidate = value as Record<string, unknown>;
  const result: ScrollPositions = {};
  if (validScrollPosition(candidate.rendered)) result.rendered = candidate.rendered;
  if (validScrollPosition(candidate.source)) result.source = candidate.source;
  if (validScrollPosition(candidate.safe)) result.safe = candidate.safe;
  return result;
}

export function createSessionUiStateStore() {
  let scrollPositions = $state<Map<string, ScrollPositions>>(new Map());
  let version = $state(0);
  let restoreVersion = $state(0);
  let versionTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleVersionChange() {
    clearTimeout(versionTimer);
    versionTimer = setTimeout(() => {
      versionTimer = undefined;
      version++;
    }, 200);
  }

  return {
    get version() {
      return version;
    },
    get restoreVersion() {
      return restoreVersion;
    },
    getScroll(tabId: string, mode: ScrollViewMode): number | undefined {
      return scrollPositions.get(tabId)?.[mode];
    },
    setScroll(tabId: string, mode: ScrollViewMode, position: number) {
      if (!validScrollPosition(position)) return;
      const current = scrollPositions.get(tabId);
      if (current?.[mode] === position) return;
      const next = new Map(scrollPositions);
      next.set(tabId, { ...current, [mode]: position });
      scrollPositions = next;
      scheduleVersionChange();
    },
    restoreScrollPositions(tabId: string, value: unknown) {
      const restored = sanitizeScrollPositions(value);
      if (Object.keys(restored).length === 0) return;
      const next = new Map(scrollPositions);
      next.set(tabId, restored);
      scrollPositions = next;
      version++;
      restoreVersion++;
    },
    snapshot(tabId: string): ScrollPositions {
      return { ...(scrollPositions.get(tabId) ?? {}) };
    },
    deleteTab(tabId: string) {
      if (!scrollPositions.has(tabId)) return;
      const next = new Map(scrollPositions);
      next.delete(tabId);
      scrollPositions = next;
      version++;
    },
    clear() {
      if (scrollPositions.size === 0) return;
      scrollPositions = new Map();
      version++;
    },
  };
}

export const sessionUiStateStore = createSessionUiStateStore();
