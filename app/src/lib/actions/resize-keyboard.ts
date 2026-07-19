import type { ResizeDragOptions } from "./resize-drag";

export function resizeFromKey(
  edge: ResizeDragOptions["edge"],
  size: number,
  min: number,
  max: number,
  key: string,
  shiftKey: boolean
): number | null {
  if (key === "Home") return min;
  if (key === "End") return max;

  const step = shiftKey ? 50 : 10;
  const increaseKey =
    edge === "right"
      ? "ArrowRight"
      : edge === "left"
        ? "ArrowLeft"
        : edge === "bottom"
          ? "ArrowDown"
          : "ArrowUp";
  const decreaseKey =
    edge === "right"
      ? "ArrowLeft"
      : edge === "left"
        ? "ArrowRight"
        : edge === "bottom"
          ? "ArrowUp"
          : "ArrowDown";
  if (key !== increaseKey && key !== decreaseKey) return null;
  const next = size + (key === increaseKey ? step : -step);
  return Math.min(max, Math.max(min, next));
}
