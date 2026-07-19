import { openMarkdownFile, openSourceMarkdown } from "$lib/actions/file-actions";
import { nativePathsEqual, registerZipSource } from "$lib/document-sources";
import { explorerStore } from "$lib/stores/explorer.svelte";
import { tabStore, type ClosedTabEntry } from "$lib/stores/tab.svelte";
import type { DocumentRef, DocumentSourceInfo } from "$lib/types";

function liveZipSource(entry: ClosedTabEntry): DocumentSourceInfo | undefined {
  const source = entry.tab.source;
  if (!source || source.kind !== "zip") return source;
  if (explorerStore.source?.id === source.id) return source;
  if (tabStore.tabs.some((tab) => tab.source?.id === source.id)) return source;
  if (
    explorerStore.source?.kind === "zip" &&
    nativePathsEqual(explorerStore.source.nativePath, source.nativePath)
  ) {
    return explorerStore.source;
  }
  return undefined;
}

async function reopenSourceDocument(entry: ClosedTabEntry): Promise<boolean> {
  const savedSource = entry.tab.source;
  const savedDocument = entry.tab.document;
  if (!savedSource || !savedDocument) {
    return openMarkdownFile(entry.tab.displayPath ?? entry.tab.path);
  }

  let source = savedSource;
  let document: DocumentRef = savedDocument;
  if (savedSource.kind === "zip") {
    source = liveZipSource(entry) ?? (await registerZipSource(savedSource.nativePath));
    document = { ...savedDocument, sourceId: source.id };
  }
  return openSourceMarkdown(document, source);
}

/** 直近に閉じたタブを、保存済みコンテンツではなく通常の安全な読み込み経路で開き直す。 */
export async function reopenRecentlyClosedTab(): Promise<boolean> {
  await tabStore.waitForCloseOperations();
  const entry = tabStore.takeRecentlyClosed();
  if (!entry) return false;
  const existingIds = new Set(tabStore.tabs.map((tab) => tab.id));

  try {
    if (!(await reopenSourceDocument(entry))) return false;
    const restored = tabStore.tabs.find((tab) => tab.id === tabStore.activeTabId);
    if (restored && !existingIds.has(restored.id)) {
      tabStore.updateTab(restored.id, { viewMode: entry.tab.viewMode });
      tabStore.moveToIndex(restored.id, entry.index);
    }
    return true;
  } catch (error) {
    console.warn("閉じたタブを再度開けませんでした:", error);
    return false;
  }
}
