import { invoke } from "@tauri-apps/api/core";
import { explorerStore } from "$lib/stores/explorer.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import type { FileEntry } from "$lib/types";
import { i18n } from "$lib/i18n/index.svelte";
import { listSourceEntries, nativeDocumentPath, nativePathToDocument } from "$lib/document-sources";
import type { DocumentRef } from "$lib/types";
import { tabStore } from "$lib/stores/tab.svelte";

export const MAX_RESTORED_EXPANDED_DIRS = 64;
export const MAX_RESTORED_DIRECTORY_ENTRIES = 10_000;

export function sanitizeExpandedDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((path): path is string => typeof path === "string"))].slice(
    0,
    MAX_RESTORED_EXPANDED_DIRS
  );
}

/** 指定パス直下1階層のエントリを取得する（.gitignore考慮は設定に従う） */
export async function loadDirectory(document: DocumentRef): Promise<FileEntry[]> {
  return listSourceEntries(document, settingsStore.settings.respectGitignore);
}

/** ディレクトリの開閉を切り替え、展開時に子エントリを読み込む */
export async function toggleDirectory(entry: FileEntry): Promise<void> {
  explorerStore.toggleDir(entry.path);
  const expanded = explorerStore.expandedDirs.has(entry.path);
  if (!expanded) {
    await syncDirWatches();
    return;
  }
  if (explorerStore.loadingDirs.has(entry.path)) return;

  // 初回は遅延読み込み。読み込み済みでも、折りたたみ中（非監視）の変化を
  // 取りこぼしている可能性があるため再展開時は必ず読み直す（1階層のみで安価）
  explorerStore.setDirLoading(entry.path, true);
  try {
    const children = await loadDirectory(entry.document);
    if (entry.children) {
      explorerStore.mergeLevel(entry.path, children);
    } else {
      explorerStore.setChildren(entry.path, children);
    }
    await syncDirWatches();
  } catch (err) {
    alert(i18n.m.dialog.loadFolderFailed(entry.path, err));
  } finally {
    explorerStore.setDirLoading(entry.path, false);
  }
}

/** 保存済みの展開パスを、現在のツリーで見つかる親から順に復元する。 */
export async function restoreExpandedDirectories(value: unknown): Promise<void> {
  let pending = sanitizeExpandedDirectories(value);
  let restoredEntryCount = 0;
  let budgetExhausted = false;
  while (pending.length > 0) {
    const nextPending: string[] = [];
    let progressed = false;
    for (const path of pending) {
      if (budgetExhausted) break;
      const entry = explorerStore.getEntry(path);
      if (!entry?.isDir) {
        nextPending.push(path);
        continue;
      }

      progressed = true;
      try {
        const children = await loadDirectory(entry.document);
        if (restoredEntryCount + children.length > MAX_RESTORED_DIRECTORY_ENTRIES) {
          budgetExhausted = true;
          break;
        }
        restoredEntryCount += children.length;
        if (entry.children) explorerStore.mergeLevel(path, children);
        else explorerStore.setChildren(path, children);
        explorerStore.expandDir(path);
      } catch {
        // 削除・権限変更等で読めないディレクトリだけを黙ってスキップする。
      }
    }
    if (!progressed || budgetExhausted) break;
    pending = nextPending;
  }
  await syncDirWatches();
}

/** ルートフォルダのツリーを読み込み直す（展開状態はリセットされる） */
export async function reloadFolderTree(): Promise<void> {
  const root = explorerStore.rootDocument;
  if (!root) return;
  try {
    const tree = await loadDirectory(root);
    explorerStore.setRoot(explorerStore.rootPath ?? "", tree, explorerStore.source ?? undefined);
    await syncDirWatches();
  } catch (err) {
    alert(i18n.m.dialog.loadFolderFailed(explorerStore.rootPath ?? root.path, err));
  }
}

/** ルートフォルダを閉じ、不要になったディレクトリ監視をすべて解除する */
export async function closeFolder(): Promise<void> {
  const archiveSource = explorerStore.source?.kind === "zip" ? explorerStore.source : null;
  explorerStore.clear();
  if (
    archiveSource &&
    !tabStore.tabs.some((tab) => tab.source?.kind === "zip" && tab.source.id === archiveSource.id)
  ) {
    await invoke("unwatch_path", { path: archiveSource.nativePath }).catch(() => {});
    await invoke("unregister_source", { sourceId: archiveSource.id }).catch(() => {});
  }
  await syncDirWatches();
}

/**
 * ディレクトリ監視（directory-changed）で通知された階層を再取得して差し替える。
 * 消えた／増えたディレクトリに合わせて監視対象も同期する。
 */
export async function refreshDirectory(path: string): Promise<void> {
  // すでにツリーから消えている・ルート未設定なら何もしない
  const root = explorerStore.rootPath;
  if (!root) return;
  try {
    const document = explorerStore.source ? nativePathToDocument(explorerStore.source, path) : null;
    if (!document) return;
    const entries = await loadDirectory(document);
    explorerStore.mergeLevel(document.path || root, entries);
    await syncDirWatches();
  } catch {
    // 監視対象ごと消えた（フォルダ削除等）場合は親レベルの通知側で整理されるため黙認する
  }
}

// --- ディレクトリ監視のライフサイクル管理 ---

let watchSyncRevision = 0;
let watchSyncChain = Promise.resolve();

/** ツリー上で実際に見えている展開中ディレクトリ（＋ルート）を列挙する */
function visibleExpandedDirs(): Set<string> {
  const result = new Set<string>();
  const root = explorerStore.rootPath;
  if (!root) return result;
  const source = explorerStore.source;
  if (!source || source.capabilities.watch !== "entries") return result;
  result.add(root);
  const walk = (entries: FileEntry[]) => {
    for (const e of entries) {
      if (e.isDir && explorerStore.expandedDirs.has(e.path)) {
        const nativePath = nativeDocumentPath(source, e.document);
        if (nativePath) result.add(nativePath);
        if (e.children) walk(e.children);
      }
    }
  };
  walk(explorerStore.tree);
  return result;
}

/**
 * 「表示中のレベルだけを監視する」不変条件を保つよう、監視対象を現在の表示状態に同期する。
 * 展開/折りたたみ/ツリー差し替え/フォルダ変更のたびに呼ぶ。
 */
export async function syncDirWatches(): Promise<void> {
  const paths = [...visibleExpandedDirs()];
  const revision = ++watchSyncRevision;
  const task = watchSyncChain.then(async () => {
    if (revision !== watchSyncRevision) return;
    try {
      await invoke("reconcile_directory_watches", { paths });
    } catch (error) {
      console.warn("ディレクトリ監視の同期に失敗しました:", error);
    }
  });
  watchSyncChain = task.catch(() => {});
  await task;
}
