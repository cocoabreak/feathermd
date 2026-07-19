<script lang="ts">
  import { tabStore } from "$lib/stores/tab.svelte";
  import { settingsStore } from "$lib/stores/settings.svelte";
  import { readingStatsStore } from "$lib/stores/reading-stats.svelte";
  import { saveSettings } from "$lib/settings-store";
  import { i18n } from "$lib/i18n/index.svelte";
  import { toggleActiveSourceView } from "$lib/actions/view-actions";

  const m = $derived(i18n.m);
  const activeTab = $derived(tabStore.tabs.find((t) => t.id === tabStore.activeTabId));
  const isSourceView = $derived((activeTab?.viewMode ?? "rendered") === "source");

  const readingLabel = $derived.by(() => {
    const stats = readingStatsStore.stats;
    if (!stats) return null;
    const countLabel = stats.isCjk
      ? m.statusBar.charCount(stats.charCount.toLocaleString())
      : m.statusBar.wordCount(String(stats.wordCount));
    return m.statusBar.readingTime(countLabel, stats.minutes);
  });

  function resetZoom() {
    settingsStore.resetZoom();
    saveSettings();
  }
</script>

<footer
  class="flex h-6 shrink-0 items-center border-t bg-muted/30 px-3 text-xs text-muted-foreground print:hidden"
>
  {#if activeTab}
    <span class="truncate">{activeTab.displayPath ?? activeTab.path}</span>
  {:else}
    <span>{m.statusBar.ready}</span>
  {/if}

  <div class="flex-1"></div>

  {#if activeTab && (activeTab.renderMode ?? "full") === "full"}
    <button
      type="button"
      class="mr-3 hover:text-foreground"
      aria-pressed={isSourceView}
      aria-label={isSourceView ? m.statusBar.switchToRendered : m.statusBar.switchToSource}
      title={isSourceView ? m.statusBar.switchToRendered : m.statusBar.switchToSource}
      onclick={toggleActiveSourceView}
    >
      {isSourceView ? m.statusBar.sourceView : m.statusBar.renderedView}
    </button>
  {/if}

  {#if readingLabel}
    <span class="mr-3" title={m.statusBar.readingTimeTooltip}>{readingLabel}</span>
  {/if}

  <button onclick={resetZoom} class="hover:text-foreground" title={m.statusBar.zoomResetTooltip}>
    {settingsStore.settings.contentZoom}%
  </button>
</footer>
