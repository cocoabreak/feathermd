<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import TocPanel from "$lib/components/TocPanel.svelte";
  import Titlebar from "$lib/components/Titlebar.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import MarkdownViewer from "$lib/components/MarkdownViewer.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import Lightbox from "$lib/components/Lightbox.svelte";
  import SessionRestoreToast from "$lib/components/SessionRestoreToast.svelte";
  import AboutDialog from "$lib/components/AboutDialog.svelte";
  import UpdateNotification from "$lib/components/UpdateNotification.svelte";
  import QuickOpen from "$lib/components/QuickOpen.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import { settingsStore } from "$lib/stores/settings.svelte";
  import { tabStore } from "$lib/stores/tab.svelte";
  import { contentStore } from "$lib/stores/content.svelte";
  import { explorerStore } from "$lib/stores/explorer.svelte";
  import { uiStore } from "$lib/stores/ui.svelte";
  import { lightboxStore } from "$lib/stores/lightbox.svelte";
  import { sessionRestorePromptStore } from "$lib/stores/session-restore-prompt.svelte";
  import { historyStore } from "$lib/stores/history.svelte";
  import { flushSettings, loadSettings } from "$lib/settings-store";
  import { flushRecent, loadRecent } from "$lib/recent-store";
  import { flushTabs, loadTabsOnStartup, saveAndFlushTabs, saveTabs } from "$lib/tabs-store";
  import { warmupHighlighter } from "$lib/markdown/engine";
  import { isMarkdownPath } from "$lib/markdown/extensions";
  import { normalizePath } from "$lib/utils";
  import {
    openLargeMarkdownInSafeModeForE2e,
    openMarkdownFile,
    openSourceMarkdown,
    readSourceMarkdown,
  } from "$lib/actions/file-actions";
  import { nativeDocumentPath, nativePathsEqual } from "$lib/document-sources";
  import { SerializedTaskQueue } from "$lib/serialized-task-queue";
  import { refreshDirectory, reloadFolderTree } from "$lib/actions/explorer-actions";
  import { authorizeDevPath, authorizePath } from "$lib/actions/security";
  import { comboFromEvent, isPickerCommand, keymap } from "$lib/commands/keymap";
  import { runCommand } from "$lib/commands/registry";
  import { startCustomCss } from "$lib/custom-css/custom-css.svelte";
  import "$lib/commands/builtin";
  import { TOC_DRAWER_MEDIA_QUERY } from "$lib/responsive-toc";
  import type { DocumentSourceInfo } from "$lib/types";
  import { i18n } from "$lib/i18n/index.svelte";
  import { updateCheckStore } from "$lib/stores/update-check.svelte";
  import { pickerStore } from "$lib/stores/picker.svelte";
  import { backlinksStore } from "$lib/stores/backlinks.svelte";
  import { searchStore } from "$lib/stores/search.svelte";
  import { sessionUiStateStore } from "$lib/stores/session-ui-state.svelte";

  // タブ復元完了前に空状態でtabs.jsonを上書きしないためのガード
  let hydrated = $state(false);
  let unlistenDragDrop: UnlistenFn | undefined;
  let unlistenCliArgs: UnlistenFn | undefined;
  let stopCustomCss: (() => void) | undefined;
  let unlistenCloseRequested: UnlistenFn | undefined;
  let closing = false;
  let reloading = false;
  let destroyed = false;
  let cliProcessingReady = false;
  let cliWakePending = false;
  let cliDrainChain = Promise.resolve();
  let compactToc = $state(false);
  let tocMediaQuery: MediaQueryList | undefined;

  function syncTocLayout(event: MediaQueryList | MediaQueryListEvent) {
    compactToc = event.matches;
  }

  async function reloadAfterSaving(): Promise<void> {
    if (reloading) return;
    reloading = true;
    await Promise.all([
      hydrated && !sessionRestorePromptStore.visible ? saveAndFlushTabs() : flushTabs(),
      flushRecent(),
      flushSettings(),
    ]);
    window.location.reload();
  }

  // DnDとCLI引数の共通処理。CLI listenerを起動初期化より先に登録できるよう、
  // onMountの外に置いている。
  async function processPaths(paths: string[]) {
    if (!paths || paths.length === 0) return;
    let folderOpened = false;

    for (const rawPath of paths.slice(0, 32)) {
      const path = normalizePath(rawPath);
      try {
        const stat = await invoke<{ is_dir: boolean; is_file: boolean }>("stat_path", { path });
        if (!stat) continue;

        if (stat.is_dir && !folderOpened) {
          const { openFolder } = await import("$lib/actions/dialog-actions");
          if (!(await openFolder(path))) continue;
          sessionRestorePromptStore.hide();
          folderOpened = true;
        } else if (stat.is_file) {
          if (isMarkdownPath(path)) {
            if (!(await authorizePath(path))) continue;
            await openMarkdownFile(path);
            sessionRestorePromptStore.hide();
          } else if (path.toLowerCase().endsWith(".zip") && !folderOpened) {
            const { openArchive } = await import("$lib/actions/dialog-actions");
            if (!(await openArchive(path))) continue;
            folderOpened = true;
          }
        }
      } catch (err) {
        console.error("パスの処理に失敗:", err);
      }
    }
  }

  /**
   * 起動初期化中は通知だけ記録し、タブ復元等の完了後にRust側キューを回収する。
   * 通知が重なってもget_cli_argsとprocessPathsを常に直列実行する。
   */
  function scheduleCliDrain(): Promise<void> {
    cliWakePending = true;
    if (!cliProcessingReady) return cliDrainChain;

    cliDrainChain = cliDrainChain.then(async () => {
      if (!cliWakePending || destroyed) return;
      cliWakePending = false;
      try {
        const args = await invoke<string[]>("get_cli_args");
        await processPaths(args);
      } catch (error) {
        console.error("CLI引数の取得に失敗:", error);
      }
    });
    return cliDrainChain;
  }

  // 起動時に設定を読み込む
  onMount(async () => {
    tocMediaQuery = window.matchMedia(TOC_DRAWER_MEDIA_QUERY);
    syncTocLayout(tocMediaQuery);
    tocMediaQuery.addEventListener("change", syncTocLayout);

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        await Promise.all([
          hydrated && !sessionRestorePromptStore.visible ? saveAndFlushTabs() : flushTabs(),
          flushRecent(),
          flushSettings(),
        ]);
        unlistenCloseRequested?.();
        unlistenCloseRequested = undefined;
        await getCurrentWindow().close();
      })
      .then((unlisten) => {
        if (destroyed) unlisten();
        else unlistenCloseRequested = unlisten;
      });

    // 引数本体はRust側のキューにあり、このイベントは起床通知に過ぎない。
    // 通知を再読み込み中に取りこぼしても、下の初期回収で復元できる。
    const cliListener = listen("open-cli-args", () => {
      void scheduleCliDrain();
    });

    // ファイル/フォルダ選択でユーザーが数秒操作している間にshikiの初期化を
    // 終わらせておくため、待たずに開始する（初回レンダリングの体感待ちを削減）
    warmupHighlighter();
    const [cliUnlisten, , , sessionResult] = await Promise.all([
      cliListener,
      loadSettings(),
      loadRecent(),
      loadTabsOnStartup(),
    ]);
    if (destroyed) {
      cliUnlisten();
      return;
    }
    unlistenCliArgs = cliUnlisten;
    if (sessionResult.promptRestore) sessionRestorePromptStore.show();
    const stopCss = await startCustomCss();
    if (destroyed) {
      stopCss();
      return;
    }
    stopCustomCss = stopCss;
    hydrated = true;
    if (settingsStore.settings.checkForUpdatesOnStartup) {
      void updateCheckStore.check({ silent: true });
    }

    // ドラッグ＆ドロップ対応
    void listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      await processPaths(event.payload.paths);
    }).then((un) => {
      if (destroyed) un();
      else unlistenDragDrop = un;
    });

    // 初回引数と、listener登録前/初期化中に保留されたCLI引数をまとめて処理する。
    cliProcessingReady = true;
    await scheduleCliDrain();

    if (import.meta.env.DEV) {
      (
        window as unknown as {
          __e2e: {
            openMarkdownFile: (path: string) => Promise<void>;
            openLargeMarkdownInSafeMode: (path: string) => Promise<void>;
            openArchive: (path: string) => Promise<void>;
            openArchiveEntry: (documentPath: string) => Promise<void>;
            showUpdateAvailable: () => void;
            resetSession: () => Promise<void>;
            flushSession: () => Promise<void>;
            getState: () => unknown;
          };
        }
      ).__e2e = {
        openMarkdownFile: async (path: string) => {
          await authorizeDevPath(path);
          await openMarkdownFile(path);
        },
        openLargeMarkdownInSafeMode: async (path: string) => {
          await authorizeDevPath(path);
          await openLargeMarkdownInSafeModeForE2e(path);
        },
        openArchive: async (path: string) => {
          await authorizeDevPath(path);
          const { openArchive } = await import("$lib/actions/dialog-actions");
          await openArchive(path);
        },
        openArchiveEntry: async (documentPath: string) => {
          const source = explorerStore.source;
          if (!source || source.kind !== "zip") throw new Error("ZIP Explorerが開かれていません");
          await openSourceMarkdown({ sourceId: source.id, path: documentPath }, source);
        },
        showUpdateAvailable: () => {
          updateCheckStore.setResultForE2e({
            currentVersion: "0.1.0",
            latestVersion: "9.9.9",
            updateAvailable: true,
            releaseUrl: "https://example.invalid/feathermd/releases/9.9.9",
          });
        },
        resetSession: async () => {
          const source = explorerStore.source;
          for (const tab of [...tabStore.tabs].reverse()) await tabStore.closeAndUnwatch(tab.id);
          explorerStore.clear();
          if (source) {
            await invoke("unwatch_path", { path: source.nativePath }).catch(() => {});
            await invoke("unregister_source", { sourceId: source.id }).catch(() => {});
          }
          searchStore.restoreSessionState(null);
          sessionUiStateStore.clear();
        },
        flushSession: saveAndFlushTabs,
        getState: () => {
          const activeTab = tabStore.tabs.find((tab) => tab.id === tabStore.activeTabId);
          return {
            hydrated,
            activeTab: activeTab
              ? {
                  path: activeTab.path,
                  title: activeTab.title,
                  renderMode: activeTab.renderMode ?? "full",
                }
              : null,
            search: searchStore.sessionState,
            scroll: activeTab ? sessionUiStateStore.snapshot(activeTab.id) : {},
          };
        },
      };
    }
  });

  onDestroy(() => {
    destroyed = true;
    cliProcessingReady = false;
    tocMediaQuery?.removeEventListener("change", syncTocLayout);
    if (unlistenDragDrop) unlistenDragDrop();
    if (unlistenCliArgs) unlistenCliArgs();
    stopCustomCss?.();
    unlistenCloseRequested?.();
    if (hydrated && !sessionRestorePromptStore.visible) void saveTabs();
    void Promise.all([flushTabs(), flushRecent(), flushSettings()]);
  });

  // タブの追加/削除/切替/ピン留め変更のたびに自動保存する（呼び忘れを防ぐため
  // 各操作箇所で明示的に呼ぶのではなく、リアクティブな監視に一本化している）。
  // セッション復元の確認トースト表示中は、まだ何も開いていない空状態で
  // tabs.jsonを上書きしてしまわないよう保存を止める
  $effect(() => {
    if (!hydrated || sessionRestorePromptStore.visible) return;
    void tabStore.tabs;
    void tabStore.activeTabId;
    void explorerStore.rootPath;
    void explorerStore.expandedDirs;
    void searchStore.open;
    void searchStore.query;
    void searchStore.useRegex;
    void sessionUiStateStore.version;
    void saveTabs();
  });

  // 表示ファイルの切替をナビゲーション履歴に記録する（リンク・タブ・エクスプローラー等、
  // 手段を問わず一元捕捉。tabs.json自動保存と同じ発想）。戻る/進む自体による切替は
  // historyStore.record内の連続重複チェックで無視される。
  // record内で履歴ストアのentries/indexを読むため、untrackしないとそれらが
  // このeffectの依存になり、step()によるindex変化で再発火して重複記録される
  $effect(() => {
    const active = tabStore.tabs.find((t) => t.id === tabStore.activeTabId);
    if (active) untrack(() => historyStore.record(active.path));
  });

  // マウスの戻る/進むボタン（XButton1/2）で履歴を移動する
  $effect(() => {
    function handleMouseUp(e: MouseEvent) {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      runCommand(e.button === 3 ? "nav.back" : "nav.forward");
    }

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  });

  // グローバルキーボードショートカット
  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const reloadShortcut =
        e.key === "F5" ||
        (!e.altKey && !e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r");
      if (reloadShortcut) {
        e.preventDefault();
        void reloadAfterSaving();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const commandId = keymap[combo];
      if (!commandId) return;
      if (
        target.matches("input, textarea, [contenteditable='true']") &&
        !isPickerCommand(commandId)
      ) {
        return;
      }

      e.preventDefault();
      runCommand(commandId);
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  // ファイル監視イベントのセットアップ
  $effect(() => {
    const unlistenFns: UnlistenFn[] = [];
    const zipReloadQueue = new SerializedTaskQueue<string>();
    let disposed = false;

    function keepListener(promise: Promise<UnlistenFn>): void {
      void promise.then((unlisten) => {
        if (disposed) unlisten();
        else unlistenFns.push(unlisten);
      });
    }

    keepListener(
      listen<string>("file-changed", async (event) => {
        backlinksStore.invalidate();
        const changedPath = event.payload;
        const normalizedChangedPath = normalizePath(changedPath);
        try {
          const zipSources = new Map(
            [explorerStore.source, ...tabStore.tabs.map((tab) => tab.source)]
              .filter(
                (source) =>
                  source?.kind === "zip" &&
                  nativePathsEqual(source.nativePath, normalizedChangedPath)
              )
              .map((source) => [source!.id, source!])
          );
          if (zipSources.size > 0) {
            await Promise.all(
              [...zipSources.values()].map((source) =>
                zipReloadQueue.enqueue(source.id, async () => {
                  let refreshedSource: DocumentSourceInfo;
                  try {
                    refreshedSource = await invoke<DocumentSourceInfo>("reload_zip_source", {
                      sourceId: source.id,
                    });
                  } catch {
                    // アトミック保存の途中で一時的に不完全なZIPが見える場合だけ、短く1回再試行する。
                    await new Promise((resolve) => setTimeout(resolve, 250));
                    try {
                      refreshedSource = await invoke<DocumentSourceInfo>("reload_zip_source", {
                        sourceId: source.id,
                      });
                    } catch (error) {
                      alert(i18n.m.dialog.archiveReloadFailed(source.nativePath, error));
                      return;
                    }
                  }
                  explorerStore.updateSource(refreshedSource);
                  for (const candidate of tabStore.tabs.filter(
                    (tab) => tab.source?.id === source.id
                  )) {
                    tabStore.updateTab(candidate.id, { source: refreshedSource });
                  }
                  if (explorerStore.source?.id === source.id) await reloadFolderTree();
                  for (const tab of tabStore.tabs.filter(
                    (candidate) => candidate.source?.id === source.id
                  )) {
                    if (!tab.document) continue;
                    try {
                      const loaded = await readSourceMarkdown(tab.document, tab.path, {
                        currentMode: tab.renderMode ?? "full",
                        reason: "watch",
                      });
                      if (!loaded) continue;
                      contentStore.set(tab.path, {
                        raw: loaded.raw,
                        safeOutline: loaded.safeOutline,
                        safeOutlineTruncated: loaded.safeOutlineTruncated,
                      });
                      tabStore.updateTab(tab.id, { status: "ok", renderMode: loaded.renderMode });
                    } catch {
                      tabStore.updateTab(tab.id, { status: "deleted" });
                    }
                  }
                })
              )
            );
            return;
          }
          const matchingTabs = tabStore.tabs.filter(
            (candidate) =>
              !!candidate.document &&
              !!candidate.source &&
              !!nativeDocumentPath(candidate.source, candidate.document) &&
              nativePathsEqual(
                nativeDocumentPath(candidate.source, candidate.document)!,
                normalizedChangedPath
              )
          );
          for (const tab of matchingTabs) {
            if (!tab.document) continue;
            try {
              const modeAtReadStart = tab.renderMode ?? "full";
              const loaded = await readSourceMarkdown(tab.document, tab.path, {
                currentMode: modeAtReadStart,
                reason: "watch",
              });
              if (loaded === undefined) continue;
              const current = tabStore.tabs.find((candidate) => candidate.id === tab.id);
              if (!current || current.path !== tab.path) continue;
              if ((current.renderMode ?? "full") !== modeAtReadStart) continue;
              contentStore.set(tab.path, {
                raw: loaded.raw,
                safeOutline: loaded.safeOutline,
                safeOutlineTruncated: loaded.safeOutlineTruncated,
              });
              tabStore.updateTab(tab.id, { renderMode: loaded.renderMode, status: "ok" });
            } catch {
              // 同じ実ファイルを参照する他タブの更新は継続する。
            }
          }
        } catch {
          // 読み込み失敗時は無視
        }
      })
    );

    keepListener(
      listen<string>("file-deleted", (event) => {
        backlinksStore.invalidate();
        const deletedPath = event.payload;
        const normalizedDeletedPath = normalizePath(deletedPath);
        const deletedArchiveSourceIds = new Set(
          [explorerStore.source, ...tabStore.tabs.map((tab) => tab.source)]
            .filter(
              (source) =>
                source?.kind === "zip" && nativePathsEqual(source.nativePath, normalizedDeletedPath)
            )
            .map((source) => source!.id)
        );
        if (deletedArchiveSourceIds.size > 0) {
          for (const archiveTab of tabStore.tabs.filter((candidate) =>
            deletedArchiveSourceIds.has(candidate.source?.id ?? "")
          )) {
            tabStore.updateTab(archiveTab.id, { status: "deleted" });
          }
          return;
        }
        const matchingTabs = tabStore.tabs.filter(
          (candidate) =>
            !!candidate.document &&
            !!candidate.source &&
            !!nativeDocumentPath(candidate.source, candidate.document) &&
            nativePathsEqual(
              nativeDocumentPath(candidate.source, candidate.document)!,
              normalizedDeletedPath
            )
        );
        for (const tab of matchingTabs) {
          tabStore.updateTab(tab.id, { status: "deleted" });
        }
      })
    );

    // エクスプローラー表示中レベルのファイル増減（explorer-watch）
    keepListener(
      listen<string>("directory-changed", (event) => {
        backlinksStore.invalidate();
        void refreshDirectory(event.payload);
      })
    );

    keepListener(
      listen<string>("menu-action", (event) => {
        runCommand(event.payload);
      })
    );

    return () => {
      disposed = true;
      unlistenFns.forEach((fn) => fn());
    };
  });
</script>

<div class="print-expand flex h-screen flex-col overflow-hidden bg-background text-foreground">
  <Titlebar />
  <div class="print-expand relative flex min-h-0 flex-1">
    {#if settingsStore.settings.sidebarVisible}
      <Sidebar />
    {/if}

    <div class="print-expand flex min-w-0 flex-1 flex-col">
      <TabBar />
      <MarkdownViewer />
    </div>

    <TocPanel compact={compactToc} />
  </div>

  <StatusBar />
</div>

{#if uiStore.settingsPanelOpen}
  <SettingsPanel onclose={() => uiStore.closeSettings()} />
{/if}

{#if uiStore.aboutDialogOpen}
  <AboutDialog onclose={() => uiStore.closeAbout()} />
{/if}

{#if lightboxStore.open}
  <Lightbox />
{/if}

{#if pickerStore.mode === "quickOpen"}
  <QuickOpen />
{:else if pickerStore.mode === "commandPalette"}
  <CommandPalette />
{/if}

<SessionRestoreToast />
<UpdateNotification />
