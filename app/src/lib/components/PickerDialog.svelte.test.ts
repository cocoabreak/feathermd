import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PickerDialog from "./PickerDialog.svelte";

const messages = {
  title: "Quick Open",
  placeholder: "Type a file name",
  loadingMessage: "Loading",
  emptyMessage: "Empty",
  noResultsMessage: "No results",
};

describe("PickerDialog", () => {
  it("filters safely and selects with the keyboard", async () => {
    const onselect = vi.fn();
    const { container } = render(PickerDialog, {
      ...messages,
      items: [
        { id: "unsafe", label: '<img src=x onerror="alert(1)">.md' },
        { id: "guide", label: "Guide.md", detail: "docs/Guide.md" },
      ],
      onselect,
      onclose: vi.fn(),
    });
    const input = screen.getByRole("combobox");

    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeTruthy();

    await fireEvent.input(input, { target: { value: "guide" } });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: "guide" }));
  });

  it("moves the active option and closes with Escape", async () => {
    const onselect = vi.fn();
    const onclose = vi.fn();
    render(PickerDialog, {
      ...messages,
      items: [
        { id: "one", label: "One" },
        { id: "two", label: "Two" },
      ],
      onselect,
      onclose,
    });
    const input = screen.getByRole("combobox");

    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }));

    await fireEvent.keyDown(input, { key: "Escape" });
    expect(onclose).toHaveBeenCalledOnce();
  });
});
