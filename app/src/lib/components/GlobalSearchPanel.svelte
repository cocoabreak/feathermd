<script lang="ts">
  import { globalSearchStore } from "$lib/stores/global-search.svelte";
  import { Search, Loader2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { i18n } from "$lib/i18n/index.svelte";
  import { explorerStore } from "$lib/stores/explorer.svelte";

  const m = $derived(i18n.m);

  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    globalSearchStore.syncSource(explorerStore.source);
  });

  $effect(() => {
    if (globalSearchStore.focusTick > 0 && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  onMount(() => {
    // コンポーネントマウント時（タブが切り替わった時など）にもフォーカスを当てる
    inputEl?.focus();
    inputEl?.select();
  });
</script>

<div class="flex h-full flex-col">
  <div class="border-b p-2">
    <form
      class="relative flex flex-col gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        globalSearchStore.search();
      }}
    >
      <div class="relative flex items-center">
        <input
          bind:this={inputEl}
          type="text"
          class="w-full rounded-md border border-input bg-background pl-8 pr-20 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={m.globalSearch.placeholder}
          bind:value={globalSearchStore.query}
        />
        <div class="absolute left-2 text-muted-foreground">
          <Search size={14} />
        </div>

        <!-- Toggle buttons and clear inside input on the right -->
        <div class="absolute right-1.5 flex items-center gap-0.5">
          {#if globalSearchStore.query}
            <button
              type="button"
              class="rounded px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={m.globalSearch.clear}
              onclick={() => globalSearchStore.clear()}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
                ></line></svg
              >
            </button>
            <div class="h-3 w-px bg-border mx-0.5"></div>
          {/if}
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-muted {globalSearchStore.caseSensitive
              ? 'bg-accent text-accent-foreground ring-1 ring-ring'
              : 'text-muted-foreground'}"
            title={m.globalSearch.matchCase}
            onclick={() => (globalSearchStore.caseSensitive = !globalSearchStore.caseSensitive)}
          >
            Aa
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-muted {globalSearchStore.isRegex
              ? 'bg-accent text-accent-foreground ring-1 ring-ring'
              : 'text-muted-foreground'}"
            title={m.globalSearch.useRegex}
            onclick={() => (globalSearchStore.isRegex = !globalSearchStore.isRegex)}
          >
            .*
          </button>
        </div>
      </div>
    </form>
  </div>

  <div class="flex-1 overflow-y-auto p-2">
    {#if globalSearchStore.isSearching}
      <div class="flex items-center justify-center p-4 text-muted-foreground">
        <Loader2 class="animate-spin" size={16} />
        <span class="ml-2 text-xs">{m.globalSearch.searching}</span>
      </div>
    {:else if globalSearchStore.error}
      <div class="p-2 text-xs text-destructive">
        {globalSearchStore.error}
      </div>
    {:else if globalSearchStore.results.length > 0}
      <div class="space-y-4">
        {#if globalSearchStore.truncated}
          <p class="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
            {m.globalSearch.resultsLimited}
          </p>
        {/if}
        {#each globalSearchStore.results as result (result.filePath)}
          <div class="text-xs">
            <div
              class="mb-1 truncate font-medium text-foreground opacity-90"
              title={result.filePath}
            >
              {result.filePath.split(/[/\\]/).pop()}
            </div>
            <ul class="space-y-1">
              {#each result.matches as match (match.line_number)}
                <li>
                  <button
                    class="w-full flex items-start gap-2 rounded-sm px-1 py-1 text-left hover:bg-accent hover:text-accent-foreground"
                    onclick={() => globalSearchStore.openMatch(result, match.line_number)}
                  >
                    <span class="mt-0.5 shrink-0 text-[10px] text-muted-foreground opacity-70">
                      {match.line_number}
                    </span>
                    <span class="break-all text-muted-foreground">
                      {match.line_text}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {:else if globalSearchStore.query}
      <div class="p-4 text-center text-xs text-muted-foreground">{m.globalSearch.noResults}</div>
    {/if}
  </div>
</div>
