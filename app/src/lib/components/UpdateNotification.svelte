<script lang="ts">
  import { ExternalLink, X } from "@lucide/svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { i18n } from "$lib/i18n/index.svelte";
  import { updateCheckStore } from "$lib/stores/update-check.svelte";

  const m = $derived(i18n.m);

  function openRelease() {
    const state = updateCheckStore.state;
    if (state.status !== "available") return;
    void openUrl(state.releaseUrl)
      .then(() => updateCheckStore.dismissNotification())
      .catch((error) => console.warn("GitHub Releasesを開けませんでした:", error));
  }
</script>

{#if updateCheckStore.notificationVisible && updateCheckStore.state.status === "available"}
  <div
    role="status"
    class="fixed right-4 bottom-12 z-40 flex max-w-sm items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg print:hidden"
  >
    <span>{m.update.available(updateCheckStore.state.latestVersion)}</span>
    <button
      type="button"
      onclick={openRelease}
      class="inline-flex shrink-0 items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
    >
      {m.update.openReleases}
      <ExternalLink size={12} />
    </button>
    <button
      type="button"
      onclick={() => updateCheckStore.dismissNotification()}
      class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={m.common.close}
    >
      <X size={14} />
    </button>
  </div>
{/if}
