import { describe, expect, it, vi } from "vitest";
import { listPaletteCommands, registerCommand, runCommand } from "./registry";

describe("command registry", () => {
  it("exposes only commands with a current dynamic label", () => {
    let label = "最初の名前";
    registerCommand({ id: "test.visible", label: () => label, run: () => {} });
    registerCommand({ id: "test.internal", run: () => {} });

    expect(listPaletteCommands()).toContainEqual({ id: "test.visible", label: "最初の名前" });
    expect(listPaletteCommands().some((command) => command.id === "test.internal")).toBe(false);

    label = "変更後の名前";
    expect(listPaletteCommands()).toContainEqual({ id: "test.visible", label: "変更後の名前" });
  });

  it("runs the registered command", () => {
    const run = vi.fn();
    registerCommand({ id: "test.run", label: () => "Run", run });
    runCommand("test.run");
    expect(run).toHaveBeenCalledOnce();
  });
});
