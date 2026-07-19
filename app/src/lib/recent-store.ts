import { invoke } from "@tauri-apps/api/core";
import { recentStore, type RecentEntry } from "$lib/stores/recent.svelte";
import { LatestSaveQueue } from "$lib/state-save-queue";

interface RecentSnapshot {
  files: RecentEntry[];
  folders: RecentEntry[];
  archives: RecentEntry[];
}

const recentSaveQueue = new LatestSaveQueue<RecentSnapshot>(
  (value) => invoke("save_app_state", { kind: "recent", value }),
  100
);

/** 最近開いたファイル・フォルダーの一覧をディスクから読み込んでストアに反映する */
export async function loadRecent(): Promise<void> {
  try {
    const saved = await invoke<{
      files?: RecentEntry[];
      folders?: RecentEntry[];
      archives?: RecentEntry[];
    }>("load_app_state", { kind: "recent" });
    const files = saved.files ?? [];
    const folders = saved.folders ?? [];
    const archives = saved.archives ?? [];
    recentStore.setAll({ files, folders, archives });
  } catch (e) {
    console.warn("最近開いた一覧の読み込みに失敗しました:", e);
  }
}

/** 現在の最近開いた一覧をディスクに保存する */
export async function saveRecent(): Promise<void> {
  try {
    await recentSaveQueue.enqueue({
      files: recentStore.files.map((entry) => ({ ...entry })),
      folders: recentStore.folders.map((entry) => ({ ...entry })),
      archives: recentStore.archives.map((entry) => ({ ...entry })),
    });
  } catch (e) {
    console.warn("最近開いた一覧の保存に失敗しました:", e);
  }
}

export async function flushRecent(): Promise<void> {
  try {
    await recentSaveQueue.flush();
  } catch (error) {
    console.warn("最近使った項目の保存flushに失敗しました:", error);
  }
}
