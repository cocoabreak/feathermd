<script lang="ts">
  import { lightboxStore } from "$lib/stores/lightbox.svelte";
  import { i18n } from "$lib/i18n/index.svelte";
  import { focusTrap } from "$lib/actions/focus-trap";

  const m = $derived(i18n.m);

  const MIN_ZOOM = 0.25;

  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoom = Math.max(MIN_ZOOM, zoom * delta);
  }

  function handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    dragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
  }

  function handlePointerUp() {
    dragging = false;
  }
</script>

<!-- 外側: 半透明スクリム。元のコンテンツをうっすら透けさせ、ポップアップであることを分かりやすくする -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="dialog"
  aria-modal="true"
  aria-label={m.lightbox.dialogTitle}
  tabindex="-1"
  use:focusTrap={{ onEscape: () => lightboxStore.close() }}
  class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 print:hidden"
  onclick={(e) => {
    if (e.target === e.currentTarget) lightboxStore.close();
  }}
>
  <button
    onclick={() => lightboxStore.close()}
    class="absolute right-4 top-4 rounded p-2 text-2xl text-white/80 hover:text-white"
    aria-label={m.common.close}
  >
    ✕
  </button>

  <!-- 内側: 常に不透明なステージ。アプリのテーマCSS変数(bg-background)を使うことで、
       Mermaidの描画（明るい背景前提の文字色）でも読みやすく、将来ダークモード切替を
       実装した際にも自動追従する -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative h-[75vh] w-[75vw] cursor-grab select-none overflow-hidden rounded-lg bg-background active:cursor-grabbing"
    onwheel={handleWheel}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    ondblclick={resetView}
  >
    <div
      class="flex h-full w-full items-center justify-center"
      style="transform: translate({panX}px, {panY}px) scale({zoom})"
    >
      {#if lightboxStore.content?.type === "image"}
        <img
          src={lightboxStore.content.src}
          alt={lightboxStore.content.alt}
          class="max-h-full max-w-full object-contain"
          draggable="false"
        />
      {:else if lightboxStore.content?.type === "svg"}
        <div class="max-h-full max-w-full [&_svg]:max-h-[75vh] [&_svg]:max-w-[75vw]">
          {@html lightboxStore.content.html}
        </div>
      {/if}
    </div>
  </div>
</div>
