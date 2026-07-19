import { registerCommand } from "./registry";
import { openArchiveDialog, openFileDialog, openFolderDialog } from "$lib/actions/dialog-actions";
import { openExternalEditor } from "$lib/actions/file-actions";
import { navigateHistory } from "$lib/actions/history-actions";
import { tabStore } from "$lib/stores/tab.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import { uiStore } from "$lib/stores/ui.svelte";
import { searchStore } from "$lib/stores/search.svelte";
import { globalSearchStore } from "$lib/stores/global-search.svelte";
import { saveSettings } from "$lib/settings-store";
import { closeFolder } from "$lib/actions/explorer-actions";
import { toggleActiveSourceView } from "$lib/actions/view-actions";
import { i18n } from "$lib/i18n/index.svelte";
import { pickerStore } from "$lib/stores/picker.svelte";
import { reopenRecentlyClosedTab } from "$lib/actions/tab-actions";

registerCommand({
  id: "quickOpen.open",
  label: () => i18n.m.commands.quickOpen,
  run: () => pickerStore.openQuickOpen(),
});
registerCommand({
  id: "commandPalette.open",
  label: () => i18n.m.commands.commandPalette,
  run: () => pickerStore.openCommandPalette(),
});

registerCommand({ id: "file.open", label: () => i18n.m.commands.openFile, run: openFileDialog });
registerCommand({
  id: "file.openFolder",
  label: () => i18n.m.commands.openFolder,
  run: openFolderDialog,
});
registerCommand({
  id: "file.openArchive",
  label: () => i18n.m.commands.openArchive,
  run: openArchiveDialog,
});
registerCommand({
  id: "file.closeFolder",
  label: () => i18n.m.commands.closeExplorer,
  run: closeFolder,
});
registerCommand({
  id: "file.openExternalEditor",
  label: () => i18n.m.commands.openExternalEditor,
  run: () => openExternalEditor(),
});

registerCommand({
  id: "tab.close",
  label: () => i18n.m.commands.closeTab,
  run: () => {
    const active = tabStore.tabs.find((t) => t.id === tabStore.activeTabId);
    if (active) tabStore.closeAndUnwatch(active.id);
  },
});
registerCommand({
  id: "tab.reopenClosed",
  label: () => i18n.m.commands.reopenClosedTab,
  run: async () => {
    await reopenRecentlyClosedTab();
  },
});
registerCommand({
  id: "tab.togglePin",
  label: () => {
    const active = tabStore.tabs.find((tab) => tab.id === tabStore.activeTabId);
    return active?.pinned ? i18n.m.commands.unpinTab : i18n.m.commands.pinTab;
  },
  run: () => {
    if (tabStore.activeTabId) tabStore.togglePin(tabStore.activeTabId);
  },
});
registerCommand({
  id: "tab.closeOthers",
  label: () => i18n.m.commands.closeOtherTabs,
  run: async () => {
    if (tabStore.activeTabId) await tabStore.closeOthers(tabStore.activeTabId);
  },
});
registerCommand({
  id: "tab.closeToRight",
  label: () => i18n.m.commands.closeTabsToRight,
  run: async () => {
    if (tabStore.activeTabId) await tabStore.closeToRight(tabStore.activeTabId);
  },
});
registerCommand({
  id: "tab.next",
  label: () => i18n.m.commands.nextTab,
  run: () => tabStore.cycle(1),
});
registerCommand({
  id: "tab.prev",
  label: () => i18n.m.commands.previousTab,
  run: () => tabStore.cycle(-1),
});
for (let i = 0; i < 9; i++) {
  registerCommand({ id: `tab.jumpTo:${i}`, run: () => tabStore.jumpTo(i) });
}

registerCommand({
  id: "export.print",
  label: () => i18n.m.commands.print,
  run: async () => {
    // 印刷時のみ必要なモジュールなので、コンテキストメニュー側と同様に遅延ロードする
    const { printDocument } = await import("$lib/actions/export-actions");
    await printDocument();
  },
});

registerCommand({
  id: "nav.back",
  label: () => i18n.m.commands.back,
  run: () => void navigateHistory(-1),
});
registerCommand({
  id: "nav.forward",
  label: () => i18n.m.commands.forward,
  run: () => void navigateHistory(1),
});

registerCommand({
  id: "panel.toggleSidebar",
  label: () => i18n.m.commands.toggleSidebar,
  run: () => settingsStore.toggleSidebar(),
});
registerCommand({
  id: "panel.toggleToc",
  label: () => i18n.m.commands.toggleToc,
  run: () => settingsStore.toggleToc(),
});
registerCommand({
  id: "view.toggleSource",
  label: () => i18n.m.commands.toggleSource,
  run: toggleActiveSourceView,
});

registerCommand({
  id: "settings.open",
  label: () => i18n.m.commands.openSettings,
  run: () => uiStore.openSettings(),
});
registerCommand({ id: "settings.close", run: () => uiStore.closeSettings() });
registerCommand({
  id: "help.about",
  label: () => i18n.m.commands.about,
  run: () => uiStore.openAbout(),
});

registerCommand({
  id: "search.open",
  label: () => i18n.m.commands.findInPage,
  run: () => searchStore.openSearch(),
});

registerCommand({
  id: "globalSearch.open",
  label: () => i18n.m.commands.searchInExplorer,
  run: () => {
    // サイドバーが非表示なら表示する
    if (!settingsStore.settings.sidebarVisible) {
      settingsStore.setSidebarVisible(true);
    }
    // 検索タブに切り替える
    uiStore.setSidebarActiveTab("search");
    // 検索入力欄にフォーカスを当てる
    globalSearchStore.openSearch();
  },
});

registerCommand({
  id: "view.zoomIn",
  label: () => i18n.m.commands.zoomIn,
  run: () => {
    settingsStore.zoomIn();
    saveSettings();
  },
});
registerCommand({
  id: "view.zoomOut",
  label: () => i18n.m.commands.zoomOut,
  run: () => {
    settingsStore.zoomOut();
    saveSettings();
  },
});
registerCommand({
  id: "view.zoomReset",
  label: () => i18n.m.commands.zoomReset,
  run: () => {
    settingsStore.resetZoom();
    saveSettings();
  },
});
