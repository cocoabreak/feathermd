<script lang="ts">
  import { i18n } from "$lib/i18n/index.svelte";
  import { splitSourceAtHeadings } from "$lib/markdown/source-segments";
  import type { SafeOutlineHeading } from "$lib/types";

  let {
    raw,
    headings,
    onRequestFull,
  }: { raw: string; headings: SafeOutlineHeading[]; onRequestFull: () => void } = $props();
  const m = $derived(i18n.m);

  const segments = $derived(splitSourceAtHeadings(raw, headings));
</script>

<section class="safe-mode" aria-labelledby="safe-mode-title">
  <div class="safe-mode-banner">
    <div>
      <h2 id="safe-mode-title">{m.viewer.safeModeTitle}</h2>
      <p>{m.viewer.safeModeDescription}</p>
    </div>
    <button type="button" onclick={onRequestFull}>{m.viewer.safeModeShowFull}</button>
  </div>
  <pre>{#each segments as segment, index (index)}{#if segment.heading}<span
          id={segment.heading.id}
          class="safe-heading-anchor"
          aria-hidden="true"></span>{/if}{segment.text}{/each}</pre>
</section>

<style>
  .safe-mode-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid hsl(var(--border));
    border-radius: 0.375rem;
    background: hsl(var(--muted));
  }
  #safe-mode-title {
    margin: 0 0 0.25rem;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .safe-mode-banner p {
    margin: 0;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }
  .safe-mode-banner button {
    flex: none;
    border: 1px solid hsl(var(--border));
    border-radius: 0.25rem;
    padding: 0.375rem 0.625rem;
    background: hsl(var(--background));
    font-size: 0.75rem;
  }
  .safe-mode-banner button:hover {
    background: hsl(var(--accent));
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.875em;
    line-height: 1.6;
  }
  .safe-heading-anchor {
    scroll-margin-top: 1rem;
  }
</style>
