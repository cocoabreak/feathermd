<script lang="ts">
  import { Pin, PinOff } from "@lucide/svelte";
  import { Menu, MenuItem } from "@tauri-apps/api/menu";
  import { reopenRecentlyClosedTab } from "$lib/actions/tab-actions";
  import { tabStore } from "$lib/stores/tab.svelte";
  import { i18n } from "$lib/i18n/index.svelte";

  const m = $derived(i18n.m);
  const DRAG_THRESHOLD_PX = 5;
  type PointerSession = {
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    element: HTMLElement;
  };

  let pointerSession: PointerSession | null = null;
  let draggedId = $state<string | null>(null);
  let dropTargetId = $state<string | null>(null);
  let dropPosition = $state<"before" | "after">("before");
  let suppressClickId: string | null = null;

  function clearPointerState() {
    pointerSession = null;
    draggedId = null;
    dropTargetId = null;
  }

  function handlePointerDown(event: PointerEvent, id: string) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      !(event.target as Element).closest("[data-tab-drag-handle]")
    )
      return;
    const element = event.currentTarget as HTMLElement;
    pointerSession = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      element,
    };
    if (typeof element.setPointerCapture === "function") {
      element.setPointerCapture(event.pointerId);
    }
  }

  function tabElementAtPoint(clientX: number, clientY: number): HTMLElement | null {
    const fromPoint =
      typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-tab-id]")
        : null;
    if (fromPoint) return fromPoint;
    return (
      [...document.querySelectorAll<HTMLElement>("[data-tab-id]")].find((element) => {
        const rect = element.getBoundingClientRect();
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      }) ?? null
    );
  }

  function scrollTabBarAtEdge(source: HTMLElement, clientX: number) {
    const bar = source.parentElement;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    if (clientX < rect.left + 24) bar.scrollLeft -= 12;
    else if (clientX > rect.right - 24) bar.scrollLeft += 12;
  }

  function handlePointerMove(event: PointerEvent) {
    const session = pointerSession;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!draggedId) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance < DRAG_THRESHOLD_PX) return;
      draggedId = session.id;
    }
    event.preventDefault();
    scrollTabBarAtEdge(session.element, event.clientX);
    const targetElement = tabElementAtPoint(event.clientX, event.clientY);
    const targetId = targetElement?.dataset.tabId;
    const dragged = tabStore.tabs.find((tab) => tab.id === session.id);
    const target = tabStore.tabs.find((tab) => tab.id === targetId);
    if (!targetElement || !dragged || !target || dragged.id === target.id) {
      dropTargetId = null;
      return;
    }
    if (!!dragged.pinned !== !!target.pinned) {
      dropTargetId = null;
      return;
    }
    const rect = targetElement.getBoundingClientRect();
    dropTargetId = target.id;
    dropPosition = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  }

  function handlePointerUp(event: PointerEvent) {
    const session = pointerSession;
    if (!session || session.pointerId !== event.pointerId) return;
    if (draggedId) {
      event.preventDefault();
      if (dropTargetId) tabStore.moveRelative(draggedId, dropTargetId, dropPosition);
      suppressClickId = session.id;
      setTimeout(() => {
        if (suppressClickId === session.id) suppressClickId = null;
      }, 0);
    } else {
      // pointer capture中はWebView2が後続clickを内側のbuttonへ配送しない場合があるため、
      // ドラッグに移行しなかった操作はpointerup時点で確実にタブ切替として扱う。
      tabStore.setActive(session.id);
    }
    if (typeof session.element.releasePointerCapture === "function") {
      try {
        session.element.releasePointerCapture(event.pointerId);
      } catch {
        // pointer captureが既に失われている場合は状態のクリアだけを行う
      }
    }
    clearPointerState();
  }

  function activateTab(id: string) {
    if (suppressClickId === id) {
      suppressClickId = null;
      return;
    }
    tabStore.setActive(id);
  }

  async function showContextMenu(event: MouseEvent, id: string) {
    event.preventDefault();
    const tab = tabStore.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    const index = tabStore.tabs.findIndex((candidate) => candidate.id === id);
    const hasClosableOther = tabStore.tabs.some(
      (candidate) => candidate.id !== id && !candidate.pinned
    );
    const hasClosableRight = tabStore.tabs.slice(index + 1).some((candidate) => !candidate.pinned);

    try {
      const items: MenuItem[] = [
        await MenuItem.new({
          text: tab.pinned ? m.tabs.unpin : m.tabs.pin,
          action: () => tabStore.togglePin(id),
        }),
      ];
      if (!tab.pinned) {
        items.push(
          await MenuItem.new({
            text: m.tabs.close,
            action: () => void tabStore.closeAndUnwatch(id),
          })
        );
      }
      if (hasClosableOther) {
        items.push(
          await MenuItem.new({
            text: m.tabs.closeOthers,
            action: () => void tabStore.closeOthers(id),
          })
        );
      }
      if (hasClosableRight) {
        items.push(
          await MenuItem.new({
            text: m.tabs.closeToRight,
            action: () => void tabStore.closeToRight(id),
          })
        );
      }
      if (tabStore.canReopenClosedTab) {
        items.push(
          await MenuItem.new({
            text: m.tabs.reopenClosed,
            action: () => void reopenRecentlyClosedTab(),
          })
        );
      }
      const menu = await Menu.new({ items });
      await menu.popup();
    } catch (error) {
      console.error("タブメニューの表示に失敗しました:", error);
    }
  }
</script>

<div
  class="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-muted/30 scrollbar-thin print:hidden"
>
  {#each tabStore.tabs as tab (tab.id)}
    <div
      class="flex min-w-0 max-w-[200px] shrink-0 items-center border-r"
      class:bg-background={tab.id === tabStore.activeTabId}
      class:bg-muted={tab.id !== tabStore.activeTabId}
      class:opacity-50={draggedId === tab.id}
      class:ring-1={dropTargetId === tab.id}
      class:ring-primary={dropTargetId === tab.id}
      class:cursor-grabbing={draggedId === tab.id}
      data-tab-id={tab.id}
      onpointerdown={(event) => handlePointerDown(event, tab.id)}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={clearPointerState}
      onlostpointercapture={() => {
        if (pointerSession?.id === tab.id) clearPointerState();
      }}
      oncontextmenu={(event) => void showContextMenu(event, tab.id)}
      role="group"
      aria-label={tab.title}
    >
      <button
        class="min-w-0 flex-1 cursor-grab truncate px-3 text-left text-xs"
        class:text-muted-foreground={tab.status === "deleted"}
        data-tab-drag-handle
        onclick={() => activateTab(tab.id)}
        title={tab.displayPath ?? tab.path}
      >
        {#if tab.status === "deleted"}
          <span class="mr-1 text-destructive">✕</span>
        {/if}
        {tab.title}
      </button>
      <button
        class="px-2 text-muted-foreground hover:text-foreground"
        onclick={() => tabStore.togglePin(tab.id)}
        aria-label={tab.pinned ? m.tabs.unpin : m.tabs.pin}
        title={tab.pinned ? m.tabs.unpin : m.tabs.pin}
      >
        {#if tab.pinned}
          <PinOff size={12} class="text-foreground" />
        {:else}
          <Pin size={12} />
        {/if}
      </button>
      {#if !tab.pinned}
        <button
          class="px-2 text-muted-foreground hover:text-foreground"
          onclick={() => tabStore.closeAndUnwatch(tab.id)}
          aria-label={m.tabs.close}
        >
          ✕
        </button>
      {/if}
    </div>
  {/each}

  {#if tabStore.tabs.length === 0}
    <div class="flex items-center px-3 text-xs text-muted-foreground">{m.tabs.openFilePrompt}</div>
  {/if}
</div>
