<script lang="ts">
  import { AlertTriangle, Loader2, Network, RefreshCw } from "@lucide/svelte";
  import {
    linkInspectorStore,
    type DocumentLinkEdge,
    type LinkContextSection,
  } from "$lib/stores/links.svelte";
  import { settingsStore } from "$lib/stores/settings.svelte";
  import { tabStore } from "$lib/stores/tab.svelte";
  import { i18n } from "$lib/i18n/index.svelte";
  import { basename } from "$lib/utils";
  import LinkGraphDialog from "./LinkGraphDialog.svelte";

  type SectionName = "outgoing" | "incoming" | "broken";

  const m = $derived(i18n.m);
  const activeTab = $derived(tabStore.tabs.find((tab) => tab.id === tabStore.activeTabId));
  const canLoad = $derived(!!activeTab?.document && !!activeTab.source);
  const wikiLinksEnabled = $derived(settingsStore.settings.renderers["wiki-links"] === true);
  let activeSection = $state<SectionName>("outgoing");
  let graphOpen = $state(false);
  const section = $derived.by<LinkContextSection>(() => linkInspectorStore[activeSection]);

  $effect(() => {
    void linkInspectorStore.revision;
    const tab = activeTab;
    const hidden = settingsStore.settings.showHiddenFiles;
    const gitignore = settingsStore.settings.respectGitignore;
    const wiki = settingsStore.settings.renderers["wiki-links"];
    void hidden;
    void gitignore;
    void wiki;
    if (tab?.document && tab.source) {
      void linkInspectorStore.load(tab.document, tab.source);
    } else {
      linkInspectorStore.clear();
    }
  });

  function refresh() {
    const tab = activeTab;
    if (tab?.document && tab.source) {
      void linkInspectorStore.load(tab.document, tab.source, true);
    }
  }

  function edgePath(edge: DocumentLinkEdge): string {
    if (activeSection === "incoming") return edge.source.path;
    return edge.target?.path ?? edge.rawTarget ?? "";
  }

  function open(edge: DocumentLinkEdge) {
    if (!activeTab?.source) return;
    const document = activeSection === "incoming" ? edge.source : edge.target;
    void linkInspectorStore.openDocument(document, activeTab.source);
  }

  function omitted(sectionValue: LinkContextSection): number | null {
    return sectionValue.total === null
      ? null
      : Math.max(0, sectionValue.total - sectionValue.items.length);
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex h-8 shrink-0 items-center justify-between border-b px-2">
    <span class="truncate text-xs text-muted-foreground" title={activeTab?.document?.path}>
      {activeTab?.title ?? m.links.title}
    </span>
    <div class="flex items-center">
      <button
        type="button"
        class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        disabled={!canLoad || linkInspectorStore.isLoading}
        title={m.links.graph}
        aria-label={m.links.graph}
        onclick={() => (graphOpen = true)}
      >
        <Network size={14} />
      </button>
      <button
        type="button"
        class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        disabled={!canLoad || linkInspectorStore.isLoading}
        title={m.links.refresh}
        aria-label={m.links.refresh}
        onclick={refresh}
      >
        <RefreshCw size={14} />
      </button>
    </div>
  </div>

  <div class="grid h-8 shrink-0 grid-cols-3 border-b text-xs" role="tablist">
    {#each ["outgoing", "incoming", "broken"] as const as name}
      <button
        type="button"
        role="tab"
        aria-selected={activeSection === name}
        class="border-r px-1 text-muted-foreground last:border-r-0 hover:bg-muted"
        class:bg-muted={activeSection === name}
        class:text-foreground={activeSection === name}
        onclick={() => (activeSection = name)}
      >
        {m.links.sections[name]} ({linkInspectorStore[name].items.length})
      </button>
    {/each}
  </div>

  <div class="flex-1 overflow-y-auto p-2">
    {#if !activeTab?.document || !activeTab.source}
      <p class="p-3 text-center text-xs text-muted-foreground">{m.links.openDocument}</p>
    {:else if linkInspectorStore.isLoading}
      <div class="flex items-center justify-center p-4 text-muted-foreground" role="status">
        <Loader2 class="animate-spin" size={16} />
        <span class="ml-2 text-xs">{m.links.loading}</span>
      </div>
    {:else if linkInspectorStore.error}
      <p class="p-2 text-xs text-destructive">{m.links.failed(linkInspectorStore.error)}</p>
    {:else}
      {#if !wikiLinksEnabled}
        <p class="mb-2 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {m.links.wikiExcluded}
        </p>
      {/if}
      {#if linkInspectorStore.truncated || omitted(section) !== 0}
        <p class="mb-2 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {omitted(section) === null
            ? m.links.resultsLimitedUnknown
            : m.links.resultsLimited(omitted(section) ?? 0)}
        </p>
      {/if}
      {#if section.items.length === 0}
        <p class="p-3 text-center text-xs text-muted-foreground">
          {m.links.empty[activeSection]}
        </p>
      {:else}
        <ul class="space-y-1">
          {#each section.items as edge, index (`${edge.source.path}:${edge.target?.path}:${edge.rawTarget}:${edge.anchor}:${edge.kind}:${index}`)}
            {@const path = edgePath(edge)}
            <li>
              <svelte:element
                this={edge.target ? "button" : "div"}
                type={edge.target ? "button" : undefined}
                tabindex={edge.target ? undefined : 0}
                role={edge.target ? undefined : "group"}
                class="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                class:hover:bg-transparent={!edge.target}
                title={path}
                onclick={() => edge.target && open(edge)}
              >
                <span class="flex items-center gap-1.5 text-xs">
                  {#if !edge.target}<AlertTriangle
                      size={12}
                      class="shrink-0 text-destructive"
                    />{/if}
                  <span class="min-w-0 flex-1 truncate font-medium text-foreground">
                    {basename(path)}
                  </span>
                  <span class="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase">
                    {edge.kind === "wiki" ? m.links.wiki : m.links.markdown}
                  </span>
                  <span class="shrink-0 text-[10px] text-muted-foreground">
                    {edge.referenceCount}
                  </span>
                </span>
                <span class="block truncate text-[11px] text-muted-foreground">{path}</span>
                {#if edge.anchor}
                  <span class="block truncate text-[10px] text-muted-foreground">
                    #{edge.anchor}
                  </span>
                {/if}
              </svelte:element>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>

{#if graphOpen && activeTab?.document && activeTab.source}
  <LinkGraphDialog
    current={activeTab.document}
    source={activeTab.source}
    outgoing={linkInspectorStore.outgoing}
    incoming={linkInspectorStore.incoming}
    broken={linkInspectorStore.broken}
    onopen={(node) => {
      const target = node.document;
      if (!target || !activeTab?.source || !activeTab.document) return;
      void linkInspectorStore.openDocument(target, activeTab.source);
      graphOpen = false;
    }}
    onclose={() => (graphOpen = false)}
  />
{/if}
