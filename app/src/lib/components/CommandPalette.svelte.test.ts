import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette.svelte";
import { registerCommand } from "$lib/commands/registry";
import { pickerStore } from "$lib/stores/picker.svelte";
import { i18n } from "$lib/i18n/index.svelte";

afterEach(() => pickerStore.close());

describe("CommandPalette", () => {
  it("searches visible commands by id and runs the selection after closing", async () => {
    i18n.setLocale("ja");
    const run = vi.fn();
    registerCommand({ id: "test.paletteCommand", label: () => "対象コマンド", run });
    registerCommand({ id: "test.internalCommand", run: vi.fn() });
    pickerStore.openCommandPalette();
    render(CommandPalette);

    const input = screen.getByRole("combobox");
    await fireEvent.input(input, { target: { value: "paletteCommand" } });
    expect(screen.getByText("対象コマンド")).toBeInTheDocument();
    expect(screen.queryByText("test.internalCommand")).not.toBeInTheDocument();

    await fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(pickerStore.mode).toBeNull();
  });
});
