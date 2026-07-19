<script lang="ts">
  import { onDestroy } from "svelte";
  import { Check, Copy } from "@lucide/svelte";
  import { i18n } from "$lib/i18n/index.svelte";
  import { splitSourceAtHeadings } from "$lib/markdown/source-segments";
  import type { SafeOutlineHeading } from "$lib/types";

  let { raw, headings }: { raw: string; headings: SafeOutlineHeading[] } = $props();
  const m = $derived(i18n.m);
  const segments = $derived(splitSourceAtHeadings(raw, headings));
  let copied = $state(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  async function copySource(): Promise<void> {
    try {
      await navigator.clipboard.writeText(raw);
      copied = true;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (copied = false), 1500);
    } catch (error) {
      console.warn("Markdown source copy failed:", error);
    }
  }

  onDestroy(() => clearTimeout(resetTimer));
</script>

<section class="source-view" aria-label={m.viewer.sourceViewLabel}>
  <button
    type="button"
    class="copy-source"
    class:copy-success={copied}
    title={copied ? m.viewer.sourceCopied : m.viewer.copySource}
    aria-label={copied ? m.viewer.sourceCopied : m.viewer.copySource}
    onclick={copySource}
  >
    {#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
    <span>{copied ? m.viewer.sourceCopied : m.viewer.copySource}</span>
  </button>
  <pre><code data-source-content
      >{#each segments as segment, index (index)}{#if segment.heading}<span
            id={segment.heading.id}
            class="source-heading-anchor"
            aria-hidden="true"></span>{/if}{segment.text}{/each}</code
    ></pre>
</section>

<style>
  .source-view {
    position: relative;
    min-width: 100%;
  }
  .copy-source {
    position: sticky;
    top: 0;
    z-index: 1;
    float: right;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    margin: 0 0 0.5rem 0.75rem;
    border: 1px solid hsl(var(--border));
    border-radius: 0.25rem;
    padding: 0.375rem 0.5rem;
    background: hsl(var(--background));
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
  }
  .copy-source:hover {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }
  .copy-source.copy-success {
    color: hsl(142 71% 35%);
  }
  pre {
    min-width: max-content;
    margin: 0;
    white-space: pre;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.875em;
    line-height: 1.6;
  }
  code {
    font: inherit;
  }
  .source-heading-anchor {
    scroll-margin-top: 1rem;
  }
</style>
