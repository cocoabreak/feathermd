import { tabStore } from "$lib/stores/tab.svelte";

/** 通常表示中のアクティブタブで、レンダー表示とソース表示を切り替える。 */
export function toggleActiveSourceView(): void {
  const active = tabStore.tabs.find((tab) => tab.id === tabStore.activeTabId);
  if (!active || (active.renderMode ?? "full") === "safe") return;
  tabStore.updateTab(active.id, {
    viewMode: (active.viewMode ?? "rendered") === "source" ? "rendered" : "source",
  });
}
