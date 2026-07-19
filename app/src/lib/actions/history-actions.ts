import { historyStore } from "$lib/stores/history.svelte";
import { tabStore } from "$lib/stores/tab.svelte";
import { openMarkdownFile, openSourceMarkdown } from "$lib/actions/file-actions";
import {
  documentKey,
  getRememberedDocument,
  registerZipSource,
  rememberDocument,
} from "$lib/document-sources";

/**
 * 履歴上を1つ戻る（-1）/進む（1）。
 * 移動先がタブとして開いていればアクティブ化し、閉じていれば開き直す。
 * ファイルが開けない（削除済み等）場合はエントリを履歴から除去し、
 * 同方向の次のエントリを試す（エラーダイアログは出さない）。
 */
export async function navigateHistory(direction: 1 | -1): Promise<void> {
  for (;;) {
    const path = historyStore.step(direction);
    if (!path) return;

    const tab = tabStore.tabs.find((t) => t.path === path);
    if (tab) {
      tabStore.setActive(tab.id);
      return;
    }

    try {
      const remembered = getRememberedDocument(path);
      if (remembered) {
        try {
          await openSourceMarkdown(remembered.document, remembered.source);
        } catch (error) {
          if (remembered.source.kind !== "zip") throw error;
          // Explorerと最後のタブを閉じるとZIP索引は解放される。履歴から戻る場合は、
          // 既に許可済みのアーカイブを再登録して新しいSource IDへ履歴を付け替える。
          const source = await registerZipSource(remembered.source.nativePath);
          const document = { sourceId: source.id, path: remembered.document.path };
          const restoredPath = documentKey(document);
          rememberDocument(document, source);
          historyStore.replaceCurrent(restoredPath);
          await openSourceMarkdown(document, source);
        }
      } else {
        await openMarkdownFile(path);
      }
      return;
    } catch {
      historyStore.dropCurrent(direction);
    }
  }
}
