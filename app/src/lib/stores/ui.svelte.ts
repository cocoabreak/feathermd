function createUiStore() {
  let settingsPanelOpen = $state(false);
  let aboutDialogOpen = $state(false);
  let sidebarActiveTab = $state<"explorer" | "search" | "backlinks">("explorer");

  return {
    get settingsPanelOpen() {
      return settingsPanelOpen;
    },
    get aboutDialogOpen() {
      return aboutDialogOpen;
    },
    get sidebarActiveTab() {
      return sidebarActiveTab;
    },
    openSettings() {
      settingsPanelOpen = true;
    },
    closeSettings() {
      settingsPanelOpen = false;
    },
    openAbout() {
      aboutDialogOpen = true;
    },
    closeAbout() {
      aboutDialogOpen = false;
    },
    setSidebarActiveTab(tab: "explorer" | "search" | "backlinks") {
      sidebarActiveTab = tab;
    },
  };
}

export const uiStore = createUiStore();
