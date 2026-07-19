<script lang="ts">
  import { searchStore } from "$lib/stores/search.svelte";
  import { i18n } from "$lib/i18n/index.svelte";

  const m = $derived(i18n.m);

  let inputEl: HTMLInputElement;
  let localQuery = $state(searchStore.query);
  let debounceTimer: ReturnType<typeof setTimeout>;
  let resultsExpanded = $state(true);

  $effect(() => {
    inputEl?.focus();
    inputEl?.select();
  });

  // 全文検索結果からの遷移など、ストア側で検索語が更新された場合に追従する。
  $effect(() => {
    const query = searchStore.query;
    if (document.activeElement !== inputEl && localQuery !== query) localQuery = query;
  });

  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchStore.setQuery(localQuery), 150);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      searchStore.closeSearch();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) searchStore.prev();
      else searchStore.next();
    }
  }
</script>

<div
  class="absolute right-3 top-3 z-10 w-[30rem] max-w-[calc(100%-1.5rem)] rounded border bg-background shadow-md print:hidden"
>
  <div class="flex items-center gap-1 p-1.5">
    <input
      bind:this={inputEl}
      bind:value={localQuery}
      oninput={handleInput}
      onkeydown={handleKeydown}
      type="text"
      placeholder={m.search.placeholder}
      class="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
    />

    <button
      onclick={() => searchStore.toggleRegex()}
      class="rounded px-1.5 py-1 text-xs"
      class:bg-accent={searchStore.useRegex}
      title={m.search.regex}
      aria-label={m.search.regexToggle}
      aria-pressed={searchStore.useRegex}
    >
      .*
    </button>

    <span class="w-16 text-center text-xs text-muted-foreground" aria-live="polite">
      {#if searchStore.error}
        {m.search.invalid}
      {:else if searchStore.matchCount === 0}
        0/0
      {:else}
        {searchStore.currentIndex + 1}/{searchStore.matchCount}{searchStore.truncated ? "+" : ""}
      {/if}
    </span>

    <button
      onclick={() => searchStore.prev()}
      disabled={searchStore.matchCount === 0}
      class="rounded px-1.5 py-1 text-xs disabled:opacity-40"
      title={m.search.prev}
      aria-label={m.search.prev}>↑</button
    >
    <button
      onclick={() => searchStore.next()}
      disabled={searchStore.matchCount === 0}
      class="rounded px-1.5 py-1 text-xs disabled:opacity-40"
      title={m.search.next}
      aria-label={m.search.next}>↓</button
    >
    <button
      onclick={() => (resultsExpanded = !resultsExpanded)}
      class="rounded px-1.5 py-1 text-xs"
      title={m.search.toggleResults}
      aria-label={m.search.toggleResults}
      aria-expanded={resultsExpanded}>{resultsExpanded ? "▴" : "▾"}</button
    >
    <button
      onclick={() => searchStore.closeSearch()}
      class="rounded px-1.5 py-1 text-xs"
      title={m.common.close}
      aria-label={m.search.closeBar}>✕</button
    >
  </div>

  {#if resultsExpanded && localQuery && localQuery === searchStore.query}
    <div class="border-t" role="region" aria-label={m.search.results}>
      {#if searchStore.results.length > 0}
        <div class="max-h-80 overflow-y-auto py-1">
          {#each searchStore.results as result, index (`${result.line}-${index}`)}
            <button
              type="button"
              class="block w-full border-l-2 border-transparent px-3 py-2 text-left hover:bg-accent"
              class:border-primary={searchStore.selectedResultIndex === index}
              class:bg-accent={searchStore.selectedResultIndex === index}
              aria-current={searchStore.selectedResultIndex === index ? "true" : undefined}
              onclick={() => searchStore.selectResult(index, result.line)}
            >
              <span class="mb-0.5 block text-[11px] text-muted-foreground"
                >{m.search.line(result.line)}</span
              >
              <span class="block truncate text-xs"
                >{result.before}<mark
                  class="rounded-sm bg-yellow-200 text-inherit dark:bg-yellow-700"
                  >{result.match}</mark
                >{result.after}</span
              >
            </button>
          {/each}
        </div>
        {#if searchStore.resultsTruncated}
          <p class="border-t px-3 py-1.5 text-xs text-muted-foreground" role="status">
            {m.search.resultsLimited}
          </p>
        {/if}
      {:else if !searchStore.error}
        <p class="px-3 py-3 text-xs text-muted-foreground">0/0</p>
      {/if}
    </div>
  {/if}
</div>
