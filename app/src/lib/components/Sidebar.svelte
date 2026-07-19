<script lang="ts">
  import { explorerStore } from "$lib/stores/explorer.svelte";
  import {
    settingsStore,
    DEFAULT_SIDEBAR_WIDTH,
    MIN_PANEL_WIDTH,
    MAX_PANEL_WIDTH,
  } from "$lib/stores/settings.svelte";
  import { recentStore } from "$lib/stores/recent.svelte";
  import { saveSettings } from "$lib/settings-store";
  import { saveRecent } from "$lib/recent-store";
  import { openArchive, openFolder } from "$lib/actions/dialog-actions";
  import { parentDir } from "$lib/actions/security";
  import { isFileOutsideExplorerRoot } from "$lib/open-context";
  import { tabStore } from "$lib/stores/tab.svelte";
  import { historyStore } from "$lib/stores/history.svelte";
  import { runCommand } from "$lib/commands/registry";
  import { sessionRestorePromptStore } from "$lib/stores/session-restore-prompt.svelte";
  import FileTree from "./FileTree.svelte";
  import GlobalSearchPanel from "./GlobalSearchPanel.svelte";
  import BacklinksPanel from "./BacklinksPanel.svelte";
  import ResizeHandle from "./ResizeHandle.svelte";
  import { uiStore } from "$lib/stores/ui.svelte";
  import {
    Archive,
    ArrowLeft,
    ArrowRight,
    FilePlus,
    Folder,
    FolderOpen,
    Link2,
    Search,
    X,
  } from "@lucide/svelte";
  import { i18n } from "$lib/i18n/index.svelte";
  import { nativeDocumentPath } from "$lib/document-sources";

  const m = $derived(i18n.m);
  const activeTab = $derived(tabStore.tabs.find((tab) => tab.id === tabStore.activeTabId));
  const activeNativePath = $derived(
    activeTab?.document && activeTab.source
      ? nativeDocumentPath(activeTab.source, activeTab.document)
      : null
  );
  const activeFileOutsideRoot = $derived(
    !!activeNativePath && isFileOutsideExplorerRoot(activeNativePath, explorerStore.rootPath)
  );

  function openRecentFolder(path: string) {
    openFolder(path)
      // 直近履歴から開いたら、前回セッションの復元プロンプトは閉じる
      .then((opened) => {
        if (opened) sessionRestorePromptStore.hide();
      })
      .catch((err) => {
        alert(m.dialog.openFolderFailed(path, err));
      });
  }

  function openRecentArchive(path: string) {
    openArchive(path).catch((err) => alert(m.dialog.openArchiveFailed(path, err)));
  }

  function openContainingFolder() {
    if (!activeNativePath) return;
    openRecentFolder(parentDir(activeNativePath));
  }

  // ドラッグ中はローカルstateのみ更新し、settingsStoreへの反映はコミット時に限定する。
  // 毎フレームsettingsStoreを更新すると、MarkdownViewerのレンダリングeffectが
  // settingsStore.settings全体に依存しているため無関係な再レンダリングが発生し、
  // スクロール位置がリセットされてしまう。
  let width = $state(settingsStore.settings.sidebarWidth);

  // 起動時のloadSettings()完了（非同期）を含め、settingsStore側の変更にローカルstateを追従させる。
  $effect(() => {
    width = settingsStore.settings.sidebarWidth;
  });
</script>

<aside class="flex shrink-0 flex-col border-r bg-muted/20 print:hidden" style="width: {width}px">
  <div class="flex h-9 shrink-0 items-center border-b text-xs font-semibold text-muted-foreground">
    <button
      class="flex h-full flex-1 items-center justify-center border-r hover:bg-muted/50"
      class:bg-muted={uiStore.sidebarActiveTab === "explorer"}
      class:text-foreground={uiStore.sidebarActiveTab === "explorer"}
      onclick={() => uiStore.setSidebarActiveTab("explorer")}
      title={m.sidebar.explorer}
    >
      <Folder size={14} class="mr-1" />
      {#if width > 200}
        <span>{m.sidebar.explorer}</span>
      {/if}
    </button>
    <button
      class="flex h-full flex-1 items-center justify-center border-r hover:bg-muted/50"
      class:bg-muted={uiStore.sidebarActiveTab === "search"}
      class:text-foreground={uiStore.sidebarActiveTab === "search"}
      onclick={() => uiStore.setSidebarActiveTab("search")}
      title={m.sidebar.search}
    >
      <Search size={14} class="mr-1" />
      {#if width > 200}
        <span>{m.sidebar.search}</span>
      {/if}
    </button>
    <button
      class="flex h-full w-9 shrink-0 items-center justify-center hover:bg-muted/50"
      class:bg-muted={uiStore.sidebarActiveTab === "backlinks"}
      class:text-foreground={uiStore.sidebarActiveTab === "backlinks"}
      onclick={() => uiStore.setSidebarActiveTab("backlinks")}
      title={m.sidebar.backlinks}
      aria-label={m.sidebar.backlinks}
    >
      <Link2 size={14} />
    </button>
  </div>
  <div class="flex h-8 shrink-0 items-center gap-0.5 border-b px-1 text-muted-foreground">
    <button
      class="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-30"
      disabled={!historyStore.canGoBack}
      title={m.common.back}
      aria-label={m.common.back}
      onclick={() => runCommand("nav.back")}><ArrowLeft size={15} /></button
    >
    <button
      class="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-30"
      disabled={!historyStore.canGoForward}
      title={m.common.forward}
      aria-label={m.common.forward}
      onclick={() => runCommand("nav.forward")}><ArrowRight size={15} /></button
    >
    <span class="mx-1 h-4 border-l"></span>
    <button
      class="rounded p-1 hover:bg-muted hover:text-foreground"
      title={m.common.openFile}
      aria-label={m.common.openFile}
      onclick={() => runCommand("file.open")}><FilePlus size={15} /></button
    >
    <button
      class="rounded p-1 hover:bg-muted hover:text-foreground"
      title={m.common.openFolder}
      aria-label={m.common.openFolder}
      onclick={() => runCommand("file.openFolder")}><FolderOpen size={15} /></button
    >
    <button
      class="rounded p-1 hover:bg-muted hover:text-foreground"
      title={m.common.openArchive}
      aria-label={m.common.openArchive}
      onclick={() => runCommand("file.openArchive")}><Archive size={15} /></button
    >
  </div>
  <div class="flex flex-1 flex-col overflow-hidden">
    {#if uiStore.sidebarActiveTab === "explorer"}
      <div class="flex flex-1 flex-col overflow-y-auto py-1">
        {#if activeFileOutsideRoot}
          <div class="mx-2 mb-1 rounded border bg-background p-2 text-xs text-muted-foreground">
            <p>{explorerStore.rootPath ? m.sidebar.outsideRoot : m.sidebar.noRootForFile}</p>
            <button
              class="mt-1 text-left font-medium text-foreground hover:underline"
              onclick={openContainingFolder}>{m.sidebar.openContainingFolder}</button
            >
          </div>
        {/if}
        {#if explorerStore.rootPath === null}
          {#if recentStore.folders.length > 0}
            <p class="px-3 pt-2 text-xs text-muted-foreground">{m.sidebar.recentFolders}</p>
            <ul>
              {#each recentStore.folders as folder (folder.path)}
                <li class="group relative">
                  <button
                    class="absolute right-1 top-1/2 -translate-y-1/2 p-1 opacity-0 hover:text-foreground group-hover:opacity-100"
                    title={m.common.removeFromHistory}
                    aria-label={m.common.removeFromHistory}
                    onclick={() => {
                      recentStore.removeFolder(folder.path);
                      void saveRecent();
                    }}
                  >
                    <X size={12} />
                  </button>
                  <button
                    class="w-full truncate py-1 pl-3 pr-7 text-left text-xs hover:bg-accent"
                    title={folder.path}
                    onclick={() => openRecentFolder(folder.path)}
                  >
                    {folder.title}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if recentStore.archives.length > 0}
            <p class="px-3 pt-2 text-xs text-muted-foreground">{m.sidebar.recentArchives}</p>
            <ul>
              {#each recentStore.archives as archive (archive.path)}
                <li class="group relative">
                  <button
                    class="absolute right-1 top-1/2 -translate-y-1/2 p-1 opacity-0 hover:text-foreground group-hover:opacity-100"
                    title={m.common.removeFromHistory}
                    aria-label={m.common.removeFromHistory}
                    onclick={() => {
                      recentStore.removeArchive(archive.path);
                      void saveRecent();
                    }}
                  >
                    <X size={12} />
                  </button>
                  <button
                    class="w-full truncate py-1 pl-3 pr-7 text-left text-xs hover:bg-accent"
                    title={archive.path}
                    onclick={() => openRecentArchive(archive.path)}
                  >
                    {archive.title}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if recentStore.folders.length === 0 && recentStore.archives.length === 0}
            <p class="px-3 py-2 text-xs text-muted-foreground">{m.sidebar.openFolderPrompt}</p>
          {/if}
        {:else}
          <FileTree entries={explorerStore.tree} depth={0} />
        {/if}
      </div>
    {:else if uiStore.sidebarActiveTab === "search"}
      <div class="flex-1 overflow-y-auto py-1">
        <GlobalSearchPanel />
      </div>
    {:else if uiStore.sidebarActiveTab === "backlinks"}
      <div class="flex-1 overflow-hidden">
        <BacklinksPanel />
      </div>
    {/if}
  </div>
</aside>

<ResizeHandle
  label={m.accessibility.resizeSidebar}
  edge="right"
  size={width}
  min={MIN_PANEL_WIDTH}
  max={MAX_PANEL_WIDTH}
  defaultSize={DEFAULT_SIDEBAR_WIDTH}
  onchange={(w) => (width = w)}
  oncommit={(w) => {
    settingsStore.setSidebarWidth(w);
    saveSettings();
  }}
/>
