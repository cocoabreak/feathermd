import { describe, expect, it } from "vitest";
import { isPickerCommand, keymap, shortcutForCommand } from "./keymap";

describe("picker shortcuts", () => {
  it("assigns Ctrl+P and Ctrl+Shift+P without retaining the print conflict", () => {
    expect(keymap["Ctrl+P"]).toBe("quickOpen.open");
    expect(keymap["Ctrl+Shift+P"]).toBe("commandPalette.open");
    expect(Object.values(keymap)).not.toContain("export.print");
    expect(shortcutForCommand("quickOpen.open")).toBe("Ctrl+P");
    expect(isPickerCommand("quickOpen.open")).toBe(true);
    expect(isPickerCommand("commandPalette.open")).toBe(true);
    expect(isPickerCommand("export.print")).toBe(false);
  });

  it("閉じたタブの復元をCtrl+Shift+Tへ割り当てる", () => {
    expect(keymap["Ctrl+Shift+T"]).toBe("tab.reopenClosed");
    expect(shortcutForCommand("tab.reopenClosed")).toBe("Ctrl+Shift+T");
  });
});
