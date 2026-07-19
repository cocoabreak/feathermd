import { invoke } from "@tauri-apps/api/core";
import { tabStore } from "$lib/stores/tab.svelte";
import { explorerStore } from "$lib/stores/explorer.svelte";
import { openArchive, openFolder } from "$lib/actions/dialog-actions";
import {
  restoreExpandedDirectories,
  sanitizeExpandedDirectories,
} from "$lib/actions/explorer-actions";
import { authorizeArchivePath, authorizePath } from "$lib/actions/security";
import { openMarkdownFile, openSourceMarkdown } from "$lib/actions/file-actions";
import { nativeDocumentPath, registerNativeSource, registerZipSource } from "$lib/document-sources";
import type { DocumentSourceInfo, SourceSpec } from "$lib/types";
import { LatestSaveQueue } from "$lib/state-save-queue";
import { sessionUiStateStore, type ScrollPositions } from "$lib/stores/session-ui-state.svelte";
import { searchStore, type PersistedSearchState } from "$lib/stores/search.svelte";

interface PersistedTab {
  path: string;
  pinned: boolean;
  source?: SourceSpec;
  documentPath?: string;
  scrollPositions?: ScrollPositions;
}

interface PersistedSession {
  tabs?: PersistedTab[];
  activeIndex?: number | null;
  explorer?: SourceSpec | null;
  expandedDirs?: string[];
  search?: PersistedSearchState;
}

const tabsSaveQueue = new LatestSaveQueue<PersistedSession>(
  (value) => invoke("save_app_state", { kind: "tabs", value }),
  200
);

async function loadSession(): Promise<PersistedSession> {
  return await invoke<PersistedSession>("load_app_state", { kind: "tabs" });
}

export function restoredActiveTabId(
  restoredTabIds: ReadonlyMap<number, string>,
  activeIndex: number | null
): string | null {
  return activeIndex === null ? null : (restoredTabIds.get(activeIndex) ?? null);
}

/** 保存済みのタブ一覧・アクティブタブ・エクスプローラーのルートフォルダを実際に開き直す */
export async function restoreSavedTabs(): Promise<void> {
  try {
    const session = await loadSession();
    const saved = session.tabs ?? [];
    const activeIndex = session.activeIndex ?? null;
    const sourceCache = new Map<string, DocumentSourceInfo>();
    const restoredTabIds = new Map<number, string>();

    if (session.explorer) {
      const opened =
        session.explorer.kind === "zip"
          ? await openArchive(session.explorer.nativePath).catch(() => false)
          : await openFolder(session.explorer.nativePath).catch(() => false);
      if (opened) {
        const source = explorerStore.source;
        if (source) {
          sourceCache.set(`${session.explorer.kind}:${session.explorer.nativePath}`, source);
        }
      }
    }

    for (const [
      savedIndex,
      { path, pinned, source: persistedSource, documentPath, scrollPositions },
    ] of saved.entries()) {
      try {
        if (!persistedSource || documentPath === undefined) {
          if (!(await authorizePath(path))) continue;
          if (!(await openMarkdownFile(path))) continue;
        } else {
          const cacheKey = `${persistedSource.kind}:${persistedSource.nativePath}`;
          let source = sourceCache.get(cacheKey);
          if (!source) {
            const accessPath =
              persistedSource.kind === "native"
                ? nativeDocumentPath(
                    {
                      id: "restore",
                      label: "",
                      nativePath: persistedSource.nativePath,
                      kind: "native",
                      capabilities: {
                        watch: "entries",
                        externalEditor: true,
                        respectGitignore: true,
                        fullTextSearch: true,
                        wikiLinks: true,
                      },
                    },
                    { sourceId: "restore", path: documentPath }
                  )
                : persistedSource.nativePath;
            if (
              !accessPath ||
              !(persistedSource.kind === "zip"
                ? await authorizeArchivePath(accessPath)
                : await authorizePath(accessPath))
            )
              continue;
            source =
              persistedSource.kind === "native"
                ? await registerNativeSource(persistedSource.nativePath)
                : await registerZipSource(persistedSource.nativePath);
            sourceCache.set(cacheKey, source);
          }
          if (!(await openSourceMarkdown({ sourceId: source.id, path: documentPath }, source))) {
            continue;
          }
        }
        const restored = tabStore.tabs.find((tab) => tab.id === tabStore.activeTabId);
        if (restored) {
          restoredTabIds.set(savedIndex, restored.id);
          sessionUiStateStore.restoreScrollPositions(restored.id, scrollPositions);
          if (pinned !== !!restored.pinned) tabStore.togglePin(restored.id);
        }
      } catch {
        continue;
      }
    }

    const restoredId = restoredActiveTabId(restoredTabIds, activeIndex);
    if (restoredId) tabStore.setActive(restoredId);

    await restoreExpandedDirectories(session.expandedDirs);
    searchStore.restoreSessionState(session.search);
  } catch (e) {
    console.warn("タブの復元に失敗しました:", e);
  }
}

/** 保存済みタブを使わない場合に呼ぶ。tabs.jsonの内容を即座に破棄する */
export async function discardSavedTabs(): Promise<void> {
  try {
    void tabsSaveQueue.enqueue({
      tabs: [],
      activeIndex: null,
      explorer: null,
      expandedDirs: [],
      search: { open: false, query: "", useRegex: false },
    });
    await tabsSaveQueue.flush();
  } catch (e) {
    console.warn("保存済みタブの破棄に失敗しました:", e);
  }
}

/**
 * 起動時に呼ぶ。Ctrl+R/F5によるリロード（Rustプロセスは継続）の場合は
 * 従来通り即座に復元する。アプリの実際の起動（プロセスの初回起動）の場合は
 * 自動復元せず、保存済みタブがあるかどうかだけを返す
 * （呼び出し側でユーザーに復元するか確認する）。
 */
export async function loadTabsOnStartup(): Promise<{ promptRestore: boolean }> {
  let freshLaunch: boolean;
  try {
    freshLaunch = await invoke<boolean>("is_fresh_launch");
  } catch {
    freshLaunch = false; // 判定できない場合は従来通り即復元する
  }

  if (!freshLaunch) {
    await restoreSavedTabs();
    return { promptRestore: false };
  }

  try {
    const session = await loadSession();
    const saved = session.tabs ?? [];
    return { promptRestore: saved.length > 0 || !!session.explorer };
  } catch {
    return { promptRestore: false };
  }
}

/** 現在開いているタブ一覧・アクティブタブ・エクスプローラーのルートフォルダをディスクに保存する */
export async function saveTabs(): Promise<void> {
  try {
    const activeTab = tabStore.tabs.find((t) => t.id === tabStore.activeTabId);
    await tabsSaveQueue.enqueue({
      tabs: tabStore.tabs.map((t) => ({
        path: t.displayPath ?? t.path,
        pinned: !!t.pinned,
        source: t.source ? { kind: t.source.kind, nativePath: t.source.nativePath } : undefined,
        documentPath: t.document?.path,
        scrollPositions: sessionUiStateStore.snapshot(t.id),
      })),
      activeIndex: activeTab ? tabStore.tabs.indexOf(activeTab) : null,
      explorer: explorerStore.source
        ? { kind: explorerStore.source.kind, nativePath: explorerStore.source.nativePath }
        : null,
      expandedDirs: sanitizeExpandedDirectories([...explorerStore.expandedDirs]),
      search: searchStore.sessionState,
    });
  } catch (e) {
    console.warn("タブの保存に失敗しました:", e);
  }
}

export async function flushTabs(): Promise<void> {
  try {
    await tabsSaveQueue.flush();
  } catch (error) {
    console.warn("タブの保存flushに失敗しました:", error);
  }
}

/** 終了時にリアクティブな保存通知を待たず、最新snapshotを確実に永続化する。 */
export async function saveAndFlushTabs(): Promise<void> {
  const saving = saveTabs();
  await flushTabs();
  await saving;
}
