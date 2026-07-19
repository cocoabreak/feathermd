<script lang="ts">
  import { Loader2, RefreshCw } from "@lucide/svelte";
  import { backlinksStore } from "$lib/stores/backlinks.svelte";
  import { settingsStore } from "$lib/stores/settings.svelte";
  import { tabStore } from "$lib/stores/tab.svelte";
  import { i18n } from "$lib/i18n/index.svelte";
  import { basename } from "$lib/utils";

  const m = $derived(i18n.m);
  const activeTab = $derived(tabStore.tabs.find((tab) => tab.id === tabStore.activeTabId));
  const wikiLinksEnabled = $derived(settingsStore.settings.renderers["wiki-links"] === true);
  const canLoad = $derived(
    !!activeTab?.document &&
      !!activeTab.source &&
      activeTab.source.capabilities.wikiLinks &&
      wikiLinksEnabled
  );

  $effect(() => {
    void backlinksStore.revision;
    const tab = activeTab;
    const hidden = settingsStore.settings.showHiddenFiles;
    const gitignore = settingsStore.settings.respectGitignore;
    void hidden;
    void gitignore;
    if (canLoad && tab?.document && tab.source) {
      void backlinksStore.load(tab.document, tab.source);
    } else {
      backlinksStore.clear();
    }
  });

  function refresh() {
    const tab = activeTab;
    if (canLoad && tab?.document && tab.source) {
      void backlinksStore.load(tab.document, tab.source, true);
    }
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex h-8 shrink-0 items-center justify-between border-b px-2">
    <span class="truncate text-xs text-muted-foreground" title={activeTab?.document?.path}>
      {activeTab?.title ?? m.backlinks.title}
    </span>
    <button
      type="button"
      class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
      disabled={!canLoad || backlinksStore.isLoading}
      title={m.backlinks.refresh}
      aria-label={m.backlinks.refresh}
      onclick={refresh}
    >
      <RefreshCw size={14} />
    </button>
  </div>

  <div class="flex-1 overflow-y-auto p-2">
    {#if !activeTab?.document || !activeTab.source}
      <p class="p-3 text-center text-xs text-muted-foreground">{m.backlinks.openDocument}</p>
    {:else if !wikiLinksEnabled}
      <p class="p-3 text-center text-xs text-muted-foreground">{m.backlinks.pluginDisabled}</p>
    {:else if !activeTab.source.capabilities.wikiLinks}
      <p class="p-3 text-center text-xs text-muted-foreground">{m.backlinks.unavailable}</p>
    {:else if backlinksStore.isLoading}
      <div class="flex items-center justify-center p-4 text-muted-foreground" role="status">
        <Loader2 class="animate-spin" size={16} />
        <span class="ml-2 text-xs">{m.backlinks.loading}</span>
      </div>
    {:else if backlinksStore.error}
      <p class="p-2 text-xs text-destructive">{m.backlinks.failed(backlinksStore.error)}</p>
    {:else}
      {#if backlinksStore.truncated}
        <p class="mb-2 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {m.backlinks.resultsLimited}
        </p>
      {/if}
      {#if backlinksStore.results.length === 0}
        <p class="p-3 text-center text-xs text-muted-foreground">{m.backlinks.noResults}</p>
      {:else}
        <ul class="space-y-1">
          {#each backlinksStore.results as result (result.document.path)}
            <li>
              <button
                type="button"
                class="w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                title={result.filePath}
                onclick={() => activeTab?.source && backlinksStore.open(result, activeTab.source)}
              >
                <span class="flex items-center justify-between gap-2 text-xs">
                  <span class="truncate font-medium text-foreground">
                    {basename(result.filePath)}
                  </span>
                  <span
                    class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {result.referenceCount}
                  </span>
                </span>
                <span class="block truncate text-[11px] text-muted-foreground">
                  {result.filePath}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>
