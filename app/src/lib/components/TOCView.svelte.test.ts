import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tocStore } from "$lib/stores/toc.svelte";
import TOCView from "./TOCView.svelte";

afterEach(() => {
  tocStore.setHeadings([]);
  tocStore.setActiveId(null);
});

describe("TOCView", () => {
  it("見出し選択後にonselectを呼び出す", async () => {
    const onselect = vi.fn();
    const target = document.createElement("div");
    target.id = "section-one";
    target.scrollIntoView = vi.fn();
    document.body.append(target);
    tocStore.setHeadings([{ id: target.id, text: "Section one", level: 1 }]);

    render(TOCView, { onselect });
    await fireEvent.click(screen.getByRole("button", { name: "Section one" }));

    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    expect(tocStore.activeId).toBe(target.id);
    expect(onselect).toHaveBeenCalledOnce();
  });
});
