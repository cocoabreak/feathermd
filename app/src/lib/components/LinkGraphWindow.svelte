<script lang="ts">
  import { RefreshCw } from "@lucide/svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import LinkGraphView from "$lib/components/LinkGraphView.svelte";
  import type { LinkGraphWindowContext, LinkGraphWindowSnapshot } from "$lib/link-graph-window";
  import type { LinkContextResponse } from "$lib/stores/links.svelte";
  import { i18n } from "$lib/i18n/index.svelte";

  const m = $derived(i18n.m);
  let context = $state<LinkGraphWindowContext | null>(null);
  let response = $state<LinkContextResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let requestId = 0;
  let snapshot = $state<LinkGraphWindowSnapshot>({ contextVersion: 0, context: null });
  let pollInFlight = false;

  async function load(next: LinkGraphWindowSnapshot, forceRefresh = false): Promise<void> {
    if (!next.context) return;
    const id = ++requestId;
    const previous = context;
    const documentChanged =
      !previous ||
      previous.document.sourceId !== next.context.document.sourceId ||
      previous.document.path !== next.context.document.path;
    snapshot = next;
    context = next.context;
    if (documentChanged) response = null;
    i18n.setLocale(next.context.locale);
    document.documentElement.classList.toggle("dark", next.context.dark);
    loading = true;
    error = null;

    try {
      const result = await invoke<LinkContextResponse>("get_link_graph_data", {
        contextVersion: next.contextVersion,
        forceRefresh: forceRefresh || (!!previous && previous.revision !== next.context.revision),
      });
      if (id !== requestId || next.contextVersion !== snapshot.contextVersion) return;
      response = result;
    } catch (loadError) {
      if (id !== requestId || next.contextVersion !== snapshot.contextVersion) return;
      error = String(loadError);
    } finally {
      if (id === requestId) loading = false;
    }
  }

  async function syncContext(): Promise<void> {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const next = await invoke<LinkGraphWindowSnapshot>("get_link_graph_window_context");
      if (next.contextVersion <= snapshot.contextVersion) return;
      if (next.context) {
        void load(next);
      } else {
        requestId++;
        snapshot = next;
        context = null;
        response = null;
        error = null;
        loading = false;
      }
    } catch (syncError) {
      error = String(syncError);
    } finally {
      pollInFlight = false;
    }
  }

  onMount(() => {
    void syncContext();
    const timer = window.setInterval(() => void syncContext(), 250);
    return () => {
      window.clearInterval(timer);
      requestId++;
    };
  });
</script>

<main class="flex h-screen min-h-0 flex-col bg-background p-4 text-foreground">
  <header class="mb-3 flex shrink-0 items-center gap-3">
    <div class="min-w-0 flex-1">
      <h1 class="text-sm font-semibold">{m.links.graphTitle}</h1>
      {#if context}
        <p class="truncate text-xs text-muted-foreground" title={context.document.path}>
          {context.document.path}
        </p>
      {/if}
    </div>
    <button
      type="button"
      class="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
      aria-label={m.links.refresh}
      title={m.links.refresh}
      disabled={!context || loading}
      onclick={() => {
        if (context) void load(snapshot, true);
      }}
    >
      <RefreshCw size={16} class={loading ? "animate-spin" : ""} />
    </button>
  </header>

  {#if error}
    <div class="m-auto max-w-lg text-center text-sm text-destructive">{m.links.failed(error)}</div>
  {:else if context && response}
    <LinkGraphView
      current={context.document}
      outgoing={response.outgoing}
      incoming={response.incoming}
      broken={response.broken}
      onopen={(node) => {
        if (node.document && context) {
          void invoke("request_link_graph_document_open", {
            contextVersion: snapshot.contextVersion,
            origin: context.document,
            target: node.document,
          }).catch((openError) => {
            error = String(openError);
          });
        }
      }}
    />
  {:else}
    <div class="m-auto text-sm text-muted-foreground">
      {loading ? m.links.loading : m.links.openDocument}
    </div>
  {/if}
</main>
