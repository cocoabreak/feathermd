export interface ResizeDragOptions {
  edge: "left" | "right" | "top" | "bottom";
  size: number;
  min: number;
  max: number;
  defaultSize: number;
  enabled?: boolean;
  onchange: (size: number) => void;
  oncommit: (size: number) => void;
  ondragchange?: (dragging: boolean) => void;
}

export function resizeDrag(node: HTMLElement, initial: ResizeDragOptions) {
  let options = initial;
  let dragging = false;

  function clamp(value: number) {
    return Math.min(options.max, Math.max(options.min, value));
  }

  function onPointerDown(event: PointerEvent) {
    if (
      options.enabled === false ||
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    dragging = true;
    options.ondragchange?.(true);
    node.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const delta =
      options.edge === "right"
        ? event.movementX
        : options.edge === "left"
          ? -event.movementX
          : options.edge === "bottom"
            ? event.movementY
            : -event.movementY;
    options.onchange(clamp(options.size + delta));
  }

  function finishDrag() {
    if (!dragging) return;
    dragging = false;
    options.ondragchange?.(false);
    options.oncommit(options.size);
  }

  function onDoubleClick(event: MouseEvent) {
    if (options.enabled === false || (event.target as HTMLElement).closest("button")) return;
    options.onchange(options.defaultSize);
    options.oncommit(options.defaultSize);
  }

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove);
  node.addEventListener("pointerup", finishDrag);
  node.addEventListener("pointercancel", finishDrag);
  node.addEventListener("lostpointercapture", finishDrag);
  node.addEventListener("dblclick", onDoubleClick);

  return {
    update(next: ResizeDragOptions) {
      options = next;
    },
    destroy() {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", finishDrag);
      node.removeEventListener("pointercancel", finishDrag);
      node.removeEventListener("lostpointercapture", finishDrag);
      node.removeEventListener("dblclick", onDoubleClick);
    },
  };
}
