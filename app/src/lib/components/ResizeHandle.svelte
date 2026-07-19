<script lang="ts">
  import { resizeDrag } from "$lib/actions/resize-drag";
  import { resizeFromKey } from "$lib/actions/resize-keyboard";
  let {
    edge,
    size,
    min,
    max,
    defaultSize,
    onchange,
    oncommit,
    label,
  }: {
    edge: "left" | "right" | "top" | "bottom";
    size: number;
    min: number;
    max: number;
    defaultSize: number;
    onchange: (size: number) => void;
    oncommit: (size: number) => void;
    label: string;
  } = $props();

  let dragging = $state(false);

  const isVertical = $derived(edge === "top" || edge === "bottom");

  function handleKeydown(event: KeyboardEvent) {
    const next = resizeFromKey(edge, size, min, max, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onchange(next);
    oncommit(next);
  }
</script>

<!-- WAI-ARIAの操作可能separatorはtabindexとキーボード操作を持つ。Svelteの静的判定はこのwidgetパターンを認識しない。 -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  tabindex="0"
  aria-label={label}
  aria-orientation={isVertical ? "horizontal" : "vertical"}
  aria-valuemin={Math.round(min)}
  aria-valuemax={Math.round(max)}
  aria-valuenow={Math.round(size)}
  onkeydown={handleKeydown}
  class="group shrink-0 transition-colors {isVertical
    ? 'h-1 w-full cursor-row-resize'
    : 'w-1 h-full cursor-col-resize'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
  use:resizeDrag={{
    edge,
    size,
    min,
    max,
    defaultSize,
    onchange,
    oncommit,
    ondragchange: (value) => (dragging = value),
  }}
>
  <div
    class="{isVertical
      ? 'h-px w-full'
      : 'h-full w-px'} bg-transparent group-hover:bg-primary/40 {dragging ? 'bg-primary/40' : ''}"
  ></div>
</div>
