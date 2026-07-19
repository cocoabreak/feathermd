<script lang="ts">
  import { sessionRestorePromptStore } from "$lib/stores/session-restore-prompt.svelte";
  import { restoreSavedTabs, discardSavedTabs } from "$lib/tabs-store";
  import { i18n } from "$lib/i18n/index.svelte";

  const m = $derived(i18n.m);

  let busy = $state(false);

  async function handleRestore() {
    busy = true;
    await restoreSavedTabs();
    sessionRestorePromptStore.hide();
  }

  async function handleDiscard() {
    busy = true;
    await discardSavedTabs();
    sessionRestorePromptStore.hide();
  }
</script>

{#if sessionRestorePromptStore.visible}
  <div
    class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-background px-4 py-2 text-sm shadow-lg print:hidden"
  >
    <span>{m.sessionRestore.prompt}</span>
    <button
      onclick={handleRestore}
      disabled={busy}
      class="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
    >
      {m.sessionRestore.restore}
    </button>
    <button
      onclick={handleDiscard}
      disabled={busy}
      class="rounded px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
    >
      {m.sessionRestore.discard}
    </button>
  </div>
{/if}
