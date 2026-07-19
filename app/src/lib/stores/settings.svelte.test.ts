import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { settingsStore } from "./settings.svelte";

let initialSidebarVisible: boolean;
let initialTocVisible: boolean;
let initialUpdateCheck: boolean;

beforeEach(() => {
  initialSidebarVisible = settingsStore.settings.sidebarVisible;
  initialTocVisible = settingsStore.settings.tocVisible;
  initialUpdateCheck = settingsStore.settings.checkForUpdatesOnStartup;
});

afterEach(() => {
  settingsStore.setSidebarVisible(initialSidebarVisible);
  if (settingsStore.settings.tocVisible !== initialTocVisible) settingsStore.toggleToc();
  settingsStore.setCheckForUpdatesOnStartup(initialUpdateCheck);
});

describe("settingsStore update checks", () => {
  it("起動時の更新確認を有効・無効化できる", () => {
    settingsStore.setCheckForUpdatesOnStartup(false);
    expect(settingsStore.settings.checkForUpdatesOnStartup).toBe(false);

    settingsStore.setCheckForUpdatesOnStartup(true);
    expect(settingsStore.settings.checkForUpdatesOnStartup).toBe(true);
  });
});

describe("settingsStore TOC visibility", () => {
  it("目次を有効化しても非表示のエクスプローラーを強制表示しない", () => {
    settingsStore.setSidebarVisible(false);
    if (settingsStore.settings.tocVisible) settingsStore.toggleToc();

    settingsStore.toggleToc();

    expect(settingsStore.settings.tocVisible).toBe(true);
    expect(settingsStore.settings.sidebarVisible).toBe(false);
  });
});
