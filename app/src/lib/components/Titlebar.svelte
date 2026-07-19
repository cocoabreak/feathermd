<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { Copy, Menu, Minus, Square, X } from "@lucide/svelte";
  import { i18n } from "$lib/i18n/index.svelte";

  const appWindow = getCurrentWindow();
  const m = $derived(i18n.m);
  let maximized = $state(false);

  async function refreshMaximized() {
    maximized = await appWindow.isMaximized();
  }

  async function showAppMenu(target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect();
    try {
      await invoke("show_app_menu", { x: rect.left, y: rect.bottom });
    } catch (error) {
      console.warn("ネイティブメニューを表示できませんでした:", error);
    }
  }

  onMount(() => {
    void refreshMaximized();
    let destroyed = false;
    let unlisten: (() => void) | undefined;
    appWindow.onResized(refreshMaximized).then((fn) => {
      if (destroyed) fn();
      else unlisten = fn;
    });
    return () => {
      destroyed = true;
      unlisten?.();
    };
  });
</script>

<div
  role="banner"
  data-tauri-drag-region
  class="flex h-8 shrink-0 select-none items-center border-b bg-muted/40 text-xs text-muted-foreground print:hidden"
  ondblclick={(event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void appWindow.toggleMaximize().then(refreshMaximized);
  }}
>
  <div data-tauri-drag-region class="flex min-w-0 flex-1 items-center px-3">
    <button
      class="-ml-2 mr-2 flex h-7 w-8 items-center justify-center rounded hover:bg-muted hover:text-foreground"
      title={m.titlebar.menu}
      aria-label={m.titlebar.menu}
      onclick={(event) => {
        void showAppMenu(event.currentTarget);
      }}
    >
      <Menu size={16} />
    </button>
    <span data-tauri-drag-region class="truncate font-medium text-foreground">FeatherMD</span>
  </div>
  <div class="flex h-full shrink-0">
    <button
      class="flex w-11 items-center justify-center hover:bg-muted hover:text-foreground"
      title={m.titlebar.minimize}
      aria-label={m.titlebar.minimize}
      onclick={() => appWindow.minimize()}><Minus size={14} /></button
    >
    <button
      class="flex w-11 items-center justify-center hover:bg-muted hover:text-foreground"
      title={maximized ? m.titlebar.restore : m.titlebar.maximize}
      aria-label={maximized ? m.titlebar.restore : m.titlebar.maximize}
      onclick={async () => {
        await appWindow.toggleMaximize();
        await refreshMaximized();
      }}
    >
      {#if maximized}<Copy size={13} />{:else}<Square size={12} />{/if}
    </button>
    <button
      class="flex w-11 items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
      title={m.titlebar.close}
      aria-label={m.titlebar.close}
      onclick={() => appWindow.close()}><X size={15} /></button
    >
  </div>
</div>
