import { describe, expect, it, vi } from "vitest";
import { focusTrap } from "./focus-trap";

describe("focusTrap", () => {
  it("初期フォーカス、Tab循環、Escape、フォーカス復帰を処理する", async () => {
    const opener = document.createElement("button");
    const dialog = document.createElement("div");
    dialog.tabIndex = -1;
    dialog.innerHTML = "<button>first</button><button>last</button>";
    document.body.append(opener, dialog);
    opener.focus();
    const onEscape = vi.fn();
    const action = focusTrap(dialog, { onEscape });
    await Promise.resolve();

    const [first, last] = dialog.querySelectorAll<HTMLButtonElement>("button");
    expect(document.activeElement).toBe(first);
    last.focus();
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })
    );
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onEscape).toHaveBeenCalledOnce();

    action.destroy();
    expect(document.activeElement).toBe(opener);
    opener.remove();
    dialog.remove();
  });
});
