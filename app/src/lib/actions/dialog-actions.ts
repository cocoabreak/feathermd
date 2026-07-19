import { invoke } from "@tauri-apps/api/core";
import { explorerStore } from "$lib/stores/explorer.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import { recentStore } from "$lib/stores/recent.svelte";
import { saveRecent } from "$lib/recent-store";
import { openMarkdownFile } from "$lib/actions/file-actions";
import { syncDirWatches } from "$lib/actions/explorer-actions";
import { authorizeArchivePath, authorizeFolderPath } from "$lib/actions/security";
import { sessionRestorePromptStore } from "$lib/stores/session-restore-prompt.svelte";
import { tabStore } from "$lib/stores/tab.svelte";
import { i18n } from "$lib/i18n/index.svelte";
import {
  listSourceEntries,
  registerNativeSource,
  registerZipSource,
  rootDocument,
} from "$lib/document-sources";
import type { DocumentSourceInfo } from "$lib/types";

async function releaseArchiveSource(source: DocumentSourceInfo | null): Promise<void> {
  if (source?.kind !== "zip" || tabStore.tabs.some((tab) => tab.source?.id === source.id)) return;
  await invoke("unwatch_path", { path: source.nativePath }).catch(() => {});
  await invoke("unregister_source", { sourceId: source.id }).catch(() => {});
}

/** ファイル選択ダイアログを開き、選択されたMarkdownファイルをタブで開く */
export async function openFileDialog(): Promise<void> {
  let selectedPath = "";
  try {
    const path = await invoke<string | null>("pick_markdown_file");
    if (!path) return;
    selectedPath = path;
    await openMarkdownFile(path);
    // 明示的にファイルを開いたら、前回セッションの復元プロンプトは閉じる
    sessionRestorePromptStore.hide();
  } catch (err) {
    alert(i18n.m.dialog.openFileFailed(selectedPath, err));
  }
}

/** 指定パスをエクスプローラーのルートとして開く */
export async function openFolder(path: string): Promise<boolean> {
  if (!(await authorizeFolderPath(path))) return false;
  const previousSource = explorerStore.source;
  // ルート直下1階層のみ読み込む。サブフォルダは展開時に遅延取得する
  const source = await registerNativeSource(path);
  const tree = await listSourceEntries(
    rootDocument(source),
    settingsStore.settings.respectGitignore
  );
  explorerStore.setRoot(path, tree, source);
  await releaseArchiveSource(previousSource);
  // 表示中レベル（この時点ではルートのみ）のファイル増減監視を張り直す
  await syncDirWatches();
  if (!settingsStore.settings.sidebarVisible) {
    settingsStore.toggleSidebar();
  }
  recentStore.addFolder(path);
  void saveRecent();
  return true;
}

/** ZIPを読み取り専用ドキュメントソースとしてExplorerへ開く */
export async function openArchive(path: string): Promise<boolean> {
  if (!(await authorizeArchivePath(path))) return false;
  const previousSource = explorerStore.source;
  const source = await registerZipSource(path);
  const tree = await listSourceEntries(rootDocument(source), false);
  for (const tab of tabStore.tabs.filter((tab) => tab.source?.id === source.id)) {
    tabStore.updateTab(tab.id, { source });
  }
  explorerStore.setRoot(path, tree, source);
  if (previousSource?.id !== source.id) await releaseArchiveSource(previousSource);
  await invoke("watch_path", { path: source.nativePath }).catch(() => {});
  await syncDirWatches();
  if (!settingsStore.settings.sidebarVisible) settingsStore.toggleSidebar();
  sessionRestorePromptStore.hide();
  recentStore.addArchive(path);
  void saveRecent();
  return true;
}

export async function openArchiveDialog(): Promise<void> {
  let selectedPath = "";
  try {
    const path = await invoke<string | null>("pick_zip_file");
    if (!path) return;
    selectedPath = path;
    await openArchive(path);
  } catch (err) {
    alert(i18n.m.dialog.openArchiveFailed(selectedPath, err));
  }
}

/** フォルダ選択ダイアログを開き、選択されたフォルダをエクスプローラーのルートにする */
export async function openFolderDialog(): Promise<void> {
  let selectedPath = "";
  try {
    const path = await invoke<string | null>("pick_folder");
    if (!path) return;
    selectedPath = path;
    if (!(await openFolder(path))) return;
    // 明示的にフォルダを開いたら、前回セッションの復元プロンプトは閉じる
    sessionRestorePromptStore.hide();
  } catch (err) {
    alert(i18n.m.dialog.openFolderFailed(selectedPath, err));
  }
}
