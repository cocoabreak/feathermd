import { fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { resizeDrag, type ResizeDragOptions } from "./resize-drag";

function setup(overrides: Partial<ResizeDragOptions> = {}) {
  const node = document.createElement("div");
  const onchange = vi.fn();
  const oncommit = vi.fn();
  const ondragchange = vi.fn();
  Object.defineProperty(node, "setPointerCapture", { value: vi.fn(), configurable: true });
  const action = resizeDrag(node, {
    edge: "right",
    size: 224,
    min: 160,
    max: 480,
    defaultSize: 224,
    onchange,
    oncommit,
    ondragchange,
    ...overrides,
  });
  return { node, action, onchange, oncommit, ondragchange };
}

describe("resizeDrag", () => {
  it("pointer captureを失った場合もドラッグ状態を終了する", async () => {
    const { node, action, oncommit, ondragchange } = setup();

    await fireEvent.pointerDown(node, { button: 0, isPrimary: true, pointerId: 1 });
    await fireEvent.lostPointerCapture(node, { pointerId: 1 });
    await fireEvent.pointerUp(node, { pointerId: 1 });

    expect(ondragchange.mock.calls).toEqual([[true], [false]]);
    expect(oncommit).toHaveBeenCalledTimes(1);
    expect(oncommit).toHaveBeenCalledWith(224);
    action.destroy();
  });

  it("主ポインターの左ボタン以外ではドラッグを開始しない", async () => {
    const { node, action, oncommit, ondragchange } = setup();

    await fireEvent.pointerDown(node, { button: 2, isPrimary: true, pointerId: 1 });
    await fireEvent.pointerDown(node, { button: 0, isPrimary: false, pointerId: 2 });
    await fireEvent.pointerUp(node, { pointerId: 2 });

    expect(ondragchange).not.toHaveBeenCalled();
    expect(oncommit).not.toHaveBeenCalled();
    action.destroy();
  });
});
