import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ResizeHandle from "./ResizeHandle.svelte";

describe("ResizeHandle", () => {
  it("ポインター操作後に残らないfocus-visibleリングを使う", () => {
    const view = render(ResizeHandle, {
      props: {
        edge: "right",
        size: 224,
        min: 160,
        max: 480,
        defaultSize: 224,
        onchange: vi.fn(),
        oncommit: vi.fn(),
        label: "Resize sidebar",
      },
    });

    const handle = view.getByRole("separator");
    expect(handle).toHaveClass("focus-visible:ring-2");
    expect(handle).not.toHaveClass("focus:ring-2");
  });
});
