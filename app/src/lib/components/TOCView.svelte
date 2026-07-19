<script lang="ts">
  import { tocStore } from "$lib/stores/toc.svelte";
  import { frontmatterStore } from "$lib/stores/frontmatter.svelte";
  import { i18n } from "$lib/i18n/index.svelte";

  let { onselect }: { onselect?: () => void } = $props();

  const m = $derived(i18n.m);

  function formatValue(value: unknown): string {
    return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
  }

  function isPrimitiveArray(value: unknown): value is (string | number)[] {
    return Array.isArray(value) && value.every((v) => typeof v !== "object");
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    tocStore.setActiveId(id);
    onselect?.();
  }
</script>

<div class="flex-1 overflow-y-auto py-1">
  {#if frontmatterStore.data && Object.keys(frontmatterStore.data).length > 0}
    <details class="border-b px-3 py-2">
      <summary class="cursor-pointer text-xs font-semibold text-muted-foreground">
        {m.toc.metadata}
      </summary>
      <dl class="mt-1 space-y-1">
        {#each Object.entries(frontmatterStore.data) as [key, value] (key)}
          <div class="text-xs">
            <dt class="text-muted-foreground">{key}</dt>
            <dd class="mt-0.5">
              {#if isPrimitiveArray(value)}
                <div class="flex flex-wrap gap-1">
                  {#each value as item, i (i)}
                    <span class="rounded-full bg-muted px-2 py-0.5">{String(item)}</span>
                  {/each}
                </div>
              {:else}
                <span class="break-words">{formatValue(value)}</span>
              {/if}
            </dd>
          </div>
        {/each}
      </dl>
    </details>
  {/if}
  {#if tocStore.headings.length === 0}
    <p class="px-3 py-2 text-xs text-muted-foreground">{m.toc.emptyPrompt}</p>
  {:else}
    {#each tocStore.headings as heading (heading.id)}
      <button
        class="block w-full truncate py-0.5 text-left text-xs transition-colors hover:text-foreground"
        class:text-foreground={heading.id === tocStore.activeId}
        class:font-medium={heading.id === tocStore.activeId}
        class:text-muted-foreground={heading.id !== tocStore.activeId}
        style="padding-left: {(heading.level - 1) * 10 + 8}px; padding-right: 8px"
        onclick={() => scrollTo(heading.id)}
      >
        {heading.text}
      </button>
    {/each}
    {#if tocStore.truncated}
      <p class="border-t px-3 py-2 text-xs text-muted-foreground">{m.toc.outlineLimited}</p>
    {/if}
  {/if}
</div>
