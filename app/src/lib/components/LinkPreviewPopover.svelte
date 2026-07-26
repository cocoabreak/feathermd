<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    LINK_PREVIEW_TOOLTIP_ID,
    linkPreviewStore,
    type LinkPreviewStore,
  } from "$lib/stores/link-preview.svelte";
  import { i18n } from "$lib/i18n/index.svelte";

  let { store = linkPreviewStore }: { store?: LinkPreviewStore } = $props();
  const m = $derived(i18n.m);
  let popover = $state<HTMLDivElement>();
  let top = $state(8);
  let left = $state(8);

  async function updatePosition(): Promise<void> {
    const anchor = store.rect;
    if (!anchor || !popover) return;
    await tick();
    const bounds = popover.getBoundingClientRect();
    const gap = 8;
    top =
      anchor.bottom + gap + bounds.height <= window.innerHeight - gap
        ? anchor.bottom + gap
        : Math.max(gap, anchor.top - bounds.height - gap);
    left = Math.min(
      Math.max(gap, anchor.left),
      Math.max(gap, window.innerWidth - bounds.width - gap)
    );
  }

  $effect(() => {
    void store.status;
    void store.rect;
    void store.content;
    if (store.visible) void updatePosition();
  });

  onMount(() => {
    const reposition = () => {
      store.refreshRect();
      void updatePosition();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && store.visible) store.close();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("keydown", keydown);
    };
  });
</script>

{#if store.visible}
  <div
    bind:this={popover}
    id={LINK_PREVIEW_TOOLTIP_ID}
    role="tooltip"
    class="fixed z-50 w-[min(24rem,calc(100vw-1rem))] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg"
    style:top={`${top}px`}
    style:left={`${left}px`}
    onpointerenter={() => store.keepOpen()}
    onpointerleave={() => store.hide()}
  >
    {#if store.status === "loading"}
      <p class="text-sm text-muted-foreground">{m.linkPreview.loading}</p>
    {:else if store.status === "missing"}
      <p class="text-sm font-medium">{m.linkPreview.missing}</p>
      {#if store.path}
        <p class="mt-1 break-all text-xs text-muted-foreground">{store.path}</p>
      {/if}
    {:else if store.status === "error"}
      <p class="text-sm text-destructive">{m.linkPreview.failed}</p>
    {:else if store.status === "ready" && store.content}
      <p class="break-words text-sm font-semibold">{store.content.title}</p>
      <p class="mt-0.5 break-all text-xs text-muted-foreground">{store.content.path}</p>
      {#if store.content.heading}
        <p class="mt-2 text-xs font-medium">{store.content.heading}</p>
      {/if}
      {#if store.content.headingOutOfRange}
        <p class="mt-2 text-xs text-muted-foreground">{m.linkPreview.headingOutOfRange}</p>
      {:else if store.content.excerpt}
        <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
          {store.content.excerpt}
        </p>
      {:else}
        <p class="mt-2 text-xs text-muted-foreground">{m.linkPreview.noExcerpt}</p>
      {/if}
      {#if store.content.aliases.length > 0}
        <div class="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <span class="text-muted-foreground">{m.linkPreview.aliases}</span>
          {#each store.content.aliases as alias}
            <span class="rounded bg-muted px-1.5 py-0.5">{alias}</span>
          {/each}
        </div>
      {/if}
      {#if store.content.tags.length > 0}
        <div class="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <span class="text-muted-foreground">{m.linkPreview.tags}</span>
          {#each store.content.tags as tag}
            <span class="rounded bg-muted px-1.5 py-0.5">{tag}</span>
          {/each}
        </div>
      {/if}
      {#if store.content.metadataTruncated || store.content.contentTruncated}
        <p class="mt-2 text-[11px] text-muted-foreground">{m.linkPreview.truncated}</p>
      {/if}
    {/if}
  </div>
{/if}
