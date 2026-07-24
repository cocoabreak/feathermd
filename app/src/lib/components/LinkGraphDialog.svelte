<script lang="ts">
  import { X } from "@lucide/svelte";
  import { focusTrap } from "$lib/actions/focus-trap";
  import { buildLinkGraph, type LinkGraphNode } from "$lib/link-graph";
  import type { LinkContextSection } from "$lib/stores/links.svelte";
  import type { DocumentRef, DocumentSourceInfo } from "$lib/types";
  import { i18n } from "$lib/i18n/index.svelte";

  let {
    current,
    source,
    outgoing,
    incoming,
    broken,
    onopen,
    onclose,
  }: {
    current: DocumentRef;
    source: DocumentSourceInfo;
    outgoing: LinkContextSection;
    incoming: LinkContextSection;
    broken: LinkContextSection;
    onopen: (node: LinkGraphNode, source: DocumentSourceInfo) => void;
    onclose: () => void;
  } = $props();

  const m = $derived(i18n.m);
  const graph = $derived(buildLinkGraph(current, outgoing, incoming, broken));
  const byId = $derived(new Map(graph.nodes.map((node) => [node.id, node])));

  function open(node: LinkGraphNode) {
    if (!node.document || node.kind === "current") return;
    onopen(node, source);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="presentation"
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="link-graph-title"
    tabindex="-1"
    use:focusTrap={{ onEscape: onclose }}
    class="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
  >
    <div class="flex shrink-0 items-center justify-between border-b px-4 py-3">
      <h2 id="link-graph-title" class="text-sm font-semibold">{m.links.graphTitle}</h2>
      <button
        type="button"
        class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={m.common.close}
        onclick={onclose}
      >
        <X size={17} />
      </button>
    </div>
    <div class="overflow-y-auto p-4">
      <div class="mb-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{m.links.incomingColumn}</span>
        <span>{m.links.currentColumn}</span>
        <span>{m.links.outgoingColumn}</span>
      </div>
      <div class="mb-2 flex gap-4 text-[10px] text-muted-foreground" aria-label={m.links.legend}>
        <span class="inline-flex items-center gap-1">
          <span class="w-5 border-t border-foreground"></span>{m.links.markdown}
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="w-5 border-t border-dashed border-foreground"></span>{m.links.wiki}
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="h-3 w-5 rounded border border-dashed border-destructive"></span>{m.links
            .broken}
        </span>
      </div>
      <svg
        viewBox="0 0 700 420"
        class="h-auto max-h-[52vh] w-full rounded border bg-muted/10"
        role="img"
        aria-label={m.links.graphTitle}
      >
        <defs>
          <marker
            id="link-graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" class="fill-muted-foreground" />
          </marker>
        </defs>
        {#each graph.edges as edge (edge.id)}
          {@const from = byId.get(edge.from)}
          {@const to = byId.get(edge.to)}
          {#if from && to}
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              class="stroke-muted-foreground"
              stroke-width="1.5"
              stroke-dasharray={edge.kind === "wiki" ? "5 3" : undefined}
              marker-end="url(#link-graph-arrow)"
            />
          {/if}
        {/each}
        {#each graph.nodes as node (node.id)}
          <g transform={`translate(${node.x - 65} ${node.y - 18})`}>
            <rect
              width="130"
              height="36"
              rx="5"
              class="fill-background stroke-border"
              class:stroke-destructive={node.kind === "broken"}
              stroke-dasharray={node.kind === "broken" ? "5 3" : undefined}
              stroke-width={node.kind === "current" ? 2.5 : 1.5}
            />
            <text
              x="65"
              y="22"
              text-anchor="middle"
              class="pointer-events-none fill-foreground text-[11px]"
            >
              {node.label.length > 19 ? `${node.label.slice(0, 18)}…` : node.label}
            </text>
          </g>
        {/each}
      </svg>
      {#if graph.omitted === null}
        <p class="mt-2 text-xs text-muted-foreground">{m.links.graphOmittedUnknown}</p>
      {:else if graph.omitted > 0}
        <p class="mt-2 text-xs text-muted-foreground">{m.links.graphOmitted(graph.omitted)}</p>
      {/if}
      <h3 class="mt-4 text-xs font-semibold">{m.links.graphDocuments}</h3>
      <ul class="mt-2 grid gap-1 sm:grid-cols-2">
        {#each graph.nodes.filter((node) => node.kind !== "current") as node (node.id)}
          <li>
            {#if node.document}
              <button
                type="button"
                class="w-full truncate rounded border px-2 py-1.5 text-left text-xs hover:bg-muted"
                title={node.path}
                onclick={() => open(node)}
              >
                {node.path}
              </button>
            {:else}
              <button
                type="button"
                class="w-full cursor-default truncate rounded border border-dashed border-destructive/60 px-2 py-1.5 text-left text-xs text-muted-foreground"
                title={node.path}
              >
                {node.path} — {m.links.broken}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  </div>
</div>
