<script lang="ts">
  import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from "cytoscape";
  import { onMount, untrack } from "svelte";
  import { buildLinkGraph, type LinkGraphNode } from "$lib/link-graph";
  import type { LinkContextSection } from "$lib/stores/links.svelte";
  import type { DocumentRef } from "$lib/types";
  import type { LinkPreviewRect } from "$lib/stores/link-preview.svelte";
  import { i18n } from "$lib/i18n/index.svelte";

  let {
    current,
    outgoing,
    incoming,
    broken,
    onopen,
    onpreview,
    onpreviewleave,
  }: {
    current: DocumentRef;
    outgoing: LinkContextSection;
    incoming: LinkContextSection;
    broken: LinkContextSection;
    onopen: (node: LinkGraphNode) => void;
    onpreview: (
      node: LinkGraphNode,
      getRect: () => LinkPreviewRect | null,
      immediate: boolean
    ) => void;
    onpreviewleave: () => void;
  } = $props();

  const m = $derived(i18n.m);
  const graph = $derived(buildLinkGraph(current, outgoing, incoming, broken));
  const nodesById = $derived(new Map(graph.nodes.map((node) => [node.id, node])));
  let graphContainer: HTMLDivElement;
  let graphView = $state<Core | null>(null);
  let keyboardNodeId = $state<string | null>(null);
  let pointerNodeId: string | null = null;
  const keyboardNode = $derived(keyboardNodeId ? nodesById.get(keyboardNodeId) : undefined);

  function open(node: LinkGraphNode) {
    if (!node.document || node.kind === "current") return;
    onopen(node);
  }

  function themeColor(name: string): string {
    const value = getComputedStyle(graphContainer).getPropertyValue(name).trim();
    const channels = value.split(/\s+/);
    return channels.length === 3 ? `hsl(${channels.join(", ")})` : `hsl(${value})`;
  }

  function cytoscapeElements(): ElementDefinition[] {
    return [
      ...graph.nodes.map((node) => ({
        group: "nodes" as const,
        data: {
          id: node.id,
          label: node.kind === "broken" ? `⚠ ${node.label}` : node.label,
          kind: node.kind,
        },
        classes: node.kind,
      })),
      ...graph.edges.map((edge) => ({
        group: "edges" as const,
        data: {
          id: edge.id,
          source: edge.from,
          target: edge.to,
        },
        classes: edge.kind,
      })),
    ];
  }

  function cytoscapeStyles(): StylesheetJson {
    return [
      {
        selector: "node",
        style: {
          width: 130,
          height: 38,
          shape: "round-rectangle",
          label: "data(label)",
          "font-size": 11,
          "text-halign": "center",
          "text-valign": "center",
          "text-wrap": "ellipsis",
          "text-max-width": "108px",
          "background-color": themeColor("--background"),
          color: themeColor("--foreground"),
          "border-color": themeColor("--border"),
          "border-width": 1.5,
        },
      },
      {
        selector: "node.current",
        style: {
          "background-color": themeColor("--primary"),
          color: themeColor("--primary-foreground"),
          "border-color": themeColor("--primary"),
          "border-width": 2.5,
        },
      },
      {
        selector: "node.broken",
        style: {
          "background-color": themeColor("--destructive"),
          "background-opacity": 0.08,
          color: themeColor("--destructive"),
          "border-color": themeColor("--destructive"),
          "border-style": "dashed",
          "border-width": 2,
        },
      },
      {
        selector: "node:selected",
        style: {
          "overlay-color": themeColor("--primary"),
          "overlay-opacity": 0.12,
          "border-color": themeColor("--primary"),
          "border-width": 3,
        },
      },
      {
        selector: "edge",
        style: {
          width: 1.5,
          "line-color": themeColor("--muted-foreground"),
          "target-arrow-color": themeColor("--muted-foreground"),
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "arrow-scale": 0.8,
        },
      },
      {
        selector: "edge.wiki",
        style: {
          "line-style": "dashed",
        },
      },
    ];
  }

  function graphLayout() {
    return {
      name: "concentric" as const,
      animate: false,
      fit: true,
      padding: 32,
      minNodeSpacing: 32,
      avoidOverlap: true,
      concentric: (node: cytoscape.NodeSingular) => (node.data("kind") === "current" ? 2 : 1),
      levelWidth: () => 1,
    };
  }

  function nodeRect(nodeId: string): LinkPreviewRect | null {
    const view = graphView;
    if (!view) return null;
    const element = view.getElementById(nodeId);
    if (!element || element.empty()) return null;
    const bounds = element.renderedBoundingBox();
    const container = graphContainer.getBoundingClientRect();
    return {
      top: container.top + bounds.y1,
      right: container.left + bounds.x2,
      bottom: container.top + bounds.y2,
      left: container.left + bounds.x1,
      width: bounds.w,
      height: bounds.h,
    };
  }

  function previewNode(nodeId: string, immediate: boolean) {
    const node = nodesById.get(nodeId);
    if (node) onpreview(node, () => nodeRect(nodeId), immediate);
  }

  function selectGraphNode(nodeId: string, preview = false) {
    keyboardNodeId = nodeId;
    if (preview) previewNode(nodeId, true);
  }

  function applyGraphSelection(view: Core, nodeId: string | null) {
    view.nodes().unselect();
    if (!nodeId) return;
    const element = view.getElementById(nodeId);
    if (!element || element.empty()) return;
    element.select();
  }

  function handleGraphKeydown(event: KeyboardEvent) {
    const nodeIds = graph.nodes.map((node) => node.id);
    if (nodeIds.length === 0) return;

    const selectedIndex = keyboardNodeId ? nodeIds.indexOf(keyboardNodeId) : -1;
    let nextIndex: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (selectedIndex + 1) % nodeIds.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = selectedIndex <= 0 ? nodeIds.length - 1 : selectedIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = nodeIds.length - 1;
    } else if (event.key === "Enter" || event.key === " ") {
      if (keyboardNode) open(keyboardNode);
      event.preventDefault();
      return;
    } else {
      return;
    }

    event.preventDefault();
    selectGraphNode(nodeIds[nextIndex], true);
  }

  $effect(() => {
    const view = graphView;
    const elements = cytoscapeElements();
    if (!view) return;

    view.startBatch();
    view.elements().remove();
    view.add(elements);
    view.endBatch();
    view.layout(graphLayout()).run();

    const selectedId = untrack(() => keyboardNodeId);
    if (selectedId && nodesById.has(selectedId)) {
      applyGraphSelection(view, selectedId);
    } else if (selectedId) {
      keyboardNodeId = null;
      onpreviewleave();
    }
    if (pointerNodeId && !nodesById.has(pointerNodeId)) {
      pointerNodeId = null;
      onpreviewleave();
    }
  });

  $effect(() => {
    const view = graphView;
    const selectedId = keyboardNodeId;
    if (view) applyGraphSelection(view, selectedId);
  });

  onMount(() => {
    const headless = import.meta.env.MODE === "test";
    graphView = cytoscape({
      container: headless ? undefined : graphContainer,
      headless,
      elements: [],
      style: headless ? [] : cytoscapeStyles(),
      layout: graphLayout(),
      autoungrabify: true,
      boxSelectionEnabled: false,
    });
    graphView.on("tap", "node", (event) => {
      selectGraphNode(event.target.id());
      const node = nodesById.get(event.target.id());
      if (node) open(node);
    });
    graphView.on("mouseover", "node", (event) => {
      const nodeId = event.target.id();
      pointerNodeId = nodeId;
      const node = nodesById.get(nodeId);
      if (node) onpreview(node, () => nodeRect(nodeId), false);
    });
    graphView.on("mouseout", "node", () => {
      pointerNodeId = null;
      onpreviewleave();
    });
    const themeObserver = new MutationObserver(() => {
      graphView?.style(cytoscapeStyles());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      themeObserver.disconnect();
      pointerNodeId = null;
      onpreviewleave();
      graphView?.destroy();
      graphView = null;
    };
  });
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div
    class="mb-2 flex shrink-0 gap-4 text-[10px] text-muted-foreground"
    aria-label={m.links.legend}
  >
    <span class="inline-flex items-center gap-1">
      <span class="w-5 border-t border-foreground"></span>{m.links.markdown}
    </span>
    <span class="inline-flex items-center gap-1">
      <span class="w-5 border-t border-dashed border-foreground"></span>{m.links.wiki}
    </span>
    <span class="inline-flex items-center gap-1">
      <span class="h-3 w-5 rounded border border-dashed border-destructive"></span>{m.links.broken}
    </span>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Canvas graph is a custom keyboard widget) -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Canvas graph is a custom keyboard widget) -->
  <div
    bind:this={graphContainer}
    class="min-h-0 w-full flex-1 rounded border bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    role="application"
    aria-label={m.links.graphTitle}
    aria-describedby="link-graph-keyboard-help link-graph-selected-node"
    tabindex="0"
    onfocus={() => {
      if (!keyboardNodeId && graph.nodes[0]) selectGraphNode(graph.nodes[0].id, true);
    }}
    onkeydown={handleGraphKeydown}
  ></div>
  <p id="link-graph-keyboard-help" class="sr-only">{m.links.graphKeyboardHelp}</p>
  <p id="link-graph-selected-node" class="sr-only" aria-live="polite">
    {keyboardNode
      ? `${keyboardNode.path}${keyboardNode.kind === "broken" ? ` — ${m.links.broken}` : ""}`
      : ""}
  </p>
  {#if graph.omitted === null}
    <p class="mt-2 shrink-0 text-xs text-muted-foreground">{m.links.graphOmittedUnknown}</p>
  {:else if graph.omitted > 0}
    <p class="mt-2 shrink-0 text-xs text-muted-foreground">{m.links.graphOmitted(graph.omitted)}</p>
  {/if}
</div>
