<script lang="ts">
  import { tick } from "svelte";
  import { Search } from "@lucide/svelte";
  import { focusTrap } from "$lib/actions/focus-trap";
  import { highlightSegments, rankPickerItems, type PickerItem } from "$lib/picker/picker-match";

  let {
    title,
    placeholder,
    items,
    loading = false,
    loadingMessage,
    emptyMessage,
    noResultsMessage,
    onselect,
    onclose,
  }: {
    title: string;
    placeholder: string;
    items: PickerItem[];
    loading?: boolean;
    loadingMessage: string;
    emptyMessage: string;
    noResultsMessage: string;
    onselect: (item: PickerItem) => void | Promise<void>;
    onclose: () => void;
  } = $props();

  let query = $state("");
  let selectedIndex = $state(0);
  let resultList: HTMLDivElement | undefined;
  const matches = $derived(rankPickerItems(items, query));

  $effect(() => {
    if (matches.length === 0) selectedIndex = 0;
    else if (selectedIndex >= matches.length) selectedIndex = matches.length - 1;
  });

  async function revealSelection(): Promise<void> {
    await tick();
    resultList
      ?.querySelector<HTMLElement>(`[data-picker-index="${selectedIndex}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }

  function handleInput(event: Event): void {
    query = (event.currentTarget as HTMLInputElement).value;
    selectedIndex = 0;
    void revealSelection();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (matches.length > 0) selectedIndex = (selectedIndex + 1) % matches.length;
      void revealSelection();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length > 0) {
        selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
      }
      void revealSelection();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = matches[selectedIndex]?.item;
      if (selected) void onselect(selected);
    }
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onclose();
  }
</script>

<div class="picker-backdrop" role="presentation" onclick={handleBackdropClick}>
  <div
    class="picker-dialog"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    use:focusTrap={{ onEscape: onclose }}
  >
    <header>{title}</header>
    <label class="picker-input">
      <Search size={16} aria-hidden="true" />
      <input
        type="text"
        value={query}
        {placeholder}
        role="combobox"
        aria-expanded="true"
        aria-controls="picker-results"
        aria-activedescendant={matches.length > 0 ? `picker-result-${selectedIndex}` : undefined}
        autocomplete="off"
        spellcheck="false"
        oninput={handleInput}
        onkeydown={handleKeydown}
      />
    </label>

    <div id="picker-results" class="picker-results" role="listbox" bind:this={resultList}>
      {#if loading}
        <p class="picker-status">{loadingMessage}</p>
      {:else if items.length === 0}
        <p class="picker-status">{emptyMessage}</p>
      {:else if matches.length === 0}
        <p class="picker-status">{noResultsMessage}</p>
      {:else}
        {#each matches as match, index (match.item.id)}
          <button
            type="button"
            id={`picker-result-${index}`}
            class="picker-result"
            class:selected={index === selectedIndex}
            role="option"
            aria-selected={index === selectedIndex}
            data-picker-index={index}
            onmouseenter={() => (selectedIndex = index)}
            onclick={() => void onselect(match.item)}
          >
            <span class="picker-result-text">
              <span class="picker-result-label">
                {#each highlightSegments(match.item.label, match.labelMatches) as segment}
                  {#if segment.matched}<mark>{segment.text}</mark>{:else}{segment.text}{/if}
                {/each}
              </span>
              {#if match.item.detail}
                <span class="picker-result-detail">{match.item.detail}</span>
              {/if}
            </span>
            {#if match.item.shortcut}<kbd>{match.item.shortcut}</kbd>{/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: min(14vh, 7rem);
    background: hsl(0 0% 0% / 0.22);
  }
  .picker-dialog {
    width: min(42rem, calc(100vw - 2rem));
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    background: hsl(var(--popover));
    color: hsl(var(--popover-foreground));
    box-shadow: 0 1rem 3rem hsl(0 0% 0% / 0.28);
  }
  header {
    padding: 0.625rem 0.75rem 0.25rem;
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    font-weight: 600;
  }
  .picker-input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.375rem 0.5rem 0.5rem;
    border: 1px solid hsl(var(--ring));
    border-radius: 0.375rem;
    padding: 0 0.625rem;
    background: hsl(var(--background));
  }
  .picker-input:focus-within {
    box-shadow: 0 0 0 2px hsl(var(--ring) / 0.2);
  }
  input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    padding: 0.625rem 0;
    background: transparent;
    color: inherit;
    font-size: 0.875rem;
  }
  .picker-results {
    max-height: min(24rem, 55vh);
    overflow-y: auto;
    border-top: 1px solid hsl(var(--border));
    padding: 0.375rem;
  }
  .picker-result {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.75rem;
    border-radius: 0.3rem;
    padding: 0.45rem 0.55rem;
    text-align: left;
  }
  .picker-result:hover,
  .picker-result.selected {
    background: hsl(var(--accent));
    color: hsl(var(--accent-foreground));
  }
  .picker-result-text {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: baseline;
    gap: 0.75rem;
  }
  .picker-result-label {
    overflow: hidden;
    flex: 0 1 auto;
    font-size: 0.875rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  mark {
    background: transparent;
    color: hsl(var(--primary));
    font-weight: 700;
  }
  .picker-result-detail {
    overflow: hidden;
    min-width: 0;
    flex: 1;
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  kbd {
    flex: none;
    border: 1px solid hsl(var(--border));
    border-radius: 0.25rem;
    padding: 0.1rem 0.35rem;
    background: hsl(var(--muted));
    color: hsl(var(--muted-foreground));
    font-family: inherit;
    font-size: 0.6875rem;
  }
  .picker-status {
    padding: 1.75rem 1rem;
    color: hsl(var(--muted-foreground));
    font-size: 0.8125rem;
    text-align: center;
  }
</style>
