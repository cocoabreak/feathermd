<script lang="ts">
  import { ListTree, X } from "@lucide/svelte";
  import { focusTrap } from "$lib/actions/focus-trap";
  import { saveSettings } from "$lib/settings-store";
  import {
    DEFAULT_TOC_WIDTH,
    MAX_PANEL_WIDTH,
    MIN_PANEL_WIDTH,
    settingsStore,
  } from "$lib/stores/settings.svelte";
  import { tocStore } from "$lib/stores/toc.svelte";
  import { i18n } from "$lib/i18n/index.svelte";
  import ResizeHandle from "./ResizeHandle.svelte";
  import TOCView from "./TOCView.svelte";

  let { compact }: { compact: boolean } = $props();

  const m = $derived(i18n.m);
  let width = $state(settingsStore.settings.tocWidth);
  let drawerOpen = $state(false);
  const hasHeadings = $derived(tocStore.headings.length > 0);

  $effect(() => {
    width = settingsStore.settings.tocWidth;
  });

  $effect(() => {
    if (!compact || !settingsStore.settings.tocVisible || !hasHeadings) drawerOpen = false;
  });

  function closeDrawer() {
    drawerOpen = false;
  }

  function hideToc() {
    settingsStore.toggleToc();
    void saveSettings();
  }
</script>

{#if settingsStore.settings.tocVisible}
  {#if compact}
    {#if hasHeadings}
      <button
        type="button"
        class="absolute right-3 top-11 z-20 flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring print:hidden"
        aria-label={m.sidebar.openToc}
        aria-expanded={drawerOpen}
        aria-controls="toc-drawer"
        onclick={() => (drawerOpen = true)}
      >
        <ListTree size={15} />
        <span>{m.sidebar.toc}</span>
      </button>
    {/if}

    {#if drawerOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        role="presentation"
        class="absolute inset-0 z-40 bg-black/30 print:hidden"
        onclick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
      >
        <div
          id="toc-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="toc-drawer-title"
          tabindex="-1"
          use:focusTrap={{ onEscape: closeDrawer }}
          class="absolute inset-y-0 right-0 flex max-w-[85%] flex-col border-l bg-background shadow-xl"
          style="width: 360px"
        >
          <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
            <h2 id="toc-drawer-title" class="text-xs font-semibold text-muted-foreground">
              {m.sidebar.toc}
            </h2>
            <button
              type="button"
              class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={m.sidebar.closeToc}
              onclick={closeDrawer}
            >
              <X size={16} />
            </button>
          </div>
          <TOCView onselect={closeDrawer} />
        </div>
      </div>
    {/if}
  {:else}
    <div class="contents print:hidden">
      <ResizeHandle
        label={m.accessibility.resizeToc}
        edge="left"
        size={width}
        min={MIN_PANEL_WIDTH}
        max={MAX_PANEL_WIDTH}
        defaultSize={DEFAULT_TOC_WIDTH}
        onchange={(next) => (width = next)}
        oncommit={(next) => {
          settingsStore.setTocWidth(next);
          void saveSettings();
        }}
      />
      <aside class="flex shrink-0 flex-col border-l bg-muted/20" style="width: {width}px">
        <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
          <h2 class="text-xs font-semibold text-muted-foreground">{m.sidebar.toc}</h2>
          <button
            type="button"
            class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={m.sidebar.closeToc}
            title={m.sidebar.closeToc}
            onclick={hideToc}
          >
            <X size={14} />
          </button>
        </div>
        <TOCView />
      </aside>
    </div>
  {/if}
{/if}
