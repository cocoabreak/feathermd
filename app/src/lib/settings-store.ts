import { invoke } from "@tauri-apps/api/core";
import { settingsStore, type Settings } from "$lib/stores/settings.svelte";
import { LatestSaveQueue } from "$lib/state-save-queue";

const settingsSaveQueue = new LatestSaveQueue<Settings>(
  (settings) => invoke("save_app_state", { kind: "settings", value: { settings } }),
  0
);

/** 設定をディスクから読み込んでストアに反映する */
export async function loadSettings(): Promise<void> {
  try {
    const { settings: saved } = await invoke<{ settings?: Settings }>("load_app_state", {
      kind: "settings",
    });
    if (saved) {
      // 既知のキーのみ適用（将来のキー追加に対して安全）
      const current = settingsStore.settings;
      if (typeof saved.showHiddenFiles === "boolean") {
        if (saved.showHiddenFiles !== current.showHiddenFiles) {
          settingsStore.toggleHiddenFiles();
        }
      }
      if (typeof saved.respectGitignore === "boolean") {
        if (saved.respectGitignore !== current.respectGitignore) {
          settingsStore.toggleRespectGitignore();
        }
      }
      if (typeof saved.tocVisible === "boolean") {
        if (saved.tocVisible !== current.tocVisible) settingsStore.toggleToc();
      }
      if (typeof saved.sidebarVisible === "boolean") {
        if (saved.sidebarVisible !== current.sidebarVisible) settingsStore.toggleSidebar();
      }
      if (typeof saved.sidebarWidth === "number") {
        settingsStore.setSidebarWidth(saved.sidebarWidth);
      }
      if (typeof saved.tocWidth === "number") {
        settingsStore.setTocWidth(saved.tocWidth);
      }
      // 旧設定 tocHeight（px）は廃止。読み捨てて tocRatio のデフォルト/保存値を使う
      if (typeof saved.tocRatio === "number") {
        settingsStore.setTocRatio(saved.tocRatio);
      }
      if (typeof saved.contentZoom === "number") {
        settingsStore.setContentZoom(saved.contentZoom);
      }
      if (saved.renderers && typeof saved.renderers === "object") {
        // 既知キー＝現行プラグインのname（デフォルト値のキー）。保存済みの未知キー
        // （削除されたプラグインの残骸）は読み捨て、新プラグインはdefaultEnabledのまま
        for (const name of Object.keys(current.renderers)) {
          const value = saved.renderers[name];
          if (typeof value === "boolean" && value !== current.renderers[name]) {
            settingsStore.toggleRenderer(name);
          }
        }
      }
      if (["light", "dark", "system"].includes(saved.theme as string)) {
        settingsStore.setTheme(saved.theme as "light" | "dark" | "system");
      }
      if (typeof saved.codeTheme === "string") {
        settingsStore.setCodeTheme(saved.codeTheme);
      }
      if (typeof saved.showLineNumbers === "boolean") {
        if (saved.showLineNumbers !== current.showLineNumbers) {
          settingsStore.toggleLineNumbers();
        }
      }
      if (typeof saved.customCssEnabled === "boolean") {
        settingsStore.setCustomCssEnabled(saved.customCssEnabled);
      }
      if (typeof saved.customCssPath === "string") {
        settingsStore.setCustomCssPath(saved.customCssPath);
      }
      if (["block", "ask", "allow"].includes(saved.externalImagePolicy as string)) {
        settingsStore.setExternalImagePolicy(saved.externalImagePolicy);
      }
      if (["system", "ja", "en"].includes(saved.language as string)) {
        settingsStore.setLanguage(saved.language);
      }
      if (typeof saved.checkForUpdatesOnStartup === "boolean") {
        settingsStore.setCheckForUpdatesOnStartup(saved.checkForUpdatesOnStartup);
      }
    }
  } catch (e) {
    console.warn("設定の読み込みに失敗しました:", e);
  }
}

/** 現在の設定をディスクに保存する */
export async function saveSettings(): Promise<void> {
  try {
    const snapshot = JSON.parse(JSON.stringify(settingsStore.settings)) as Settings;
    await settingsSaveQueue.enqueue(snapshot);
  } catch (e) {
    console.warn("設定の保存に失敗しました:", e);
  }
}

export async function flushSettings(): Promise<void> {
  try {
    await settingsSaveQueue.flush();
  } catch (error) {
    console.warn("設定の保存flushに失敗しました:", error);
  }
}
