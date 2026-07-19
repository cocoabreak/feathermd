import { afterEach, describe, expect, it, vi } from "vitest";
import { setupCodeCopy } from "./code-copy";

function createContainer(): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = '<pre class="shiki"><code>const value = 1;</code></pre>';
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("setupCodeCopy", () => {
  it("shows a localized message only after a successful copy", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const container = createContainer();

    const cleanup = setupCodeCopy(container, {
      copy: "コードをコピー",
      copied: "コピーしました",
    });
    const button = container.querySelector<HTMLButtonElement>(".code-copy-button")!;

    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe("コードをコピー");

    button.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("const value = 1;");
    expect(button.textContent).toBe("コピーしました");
    expect(button.getAttribute("aria-label")).toBe("コピーしました");
    expect(button.classList.contains("code-copy-success")).toBe(true);

    vi.advanceTimersByTime(1500);

    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe("コードをコピー");
    expect(button.classList.contains("code-copy-success")).toBe(false);
    cleanup();
  });

  it("removes its button and listener during cleanup", () => {
    const container = createContainer();
    const pre = container.querySelector("pre")!;
    const cleanup = setupCodeCopy(container, { copy: "Copy code", copied: "Copied" });

    cleanup();

    expect(container.querySelector(".code-copy-button")).toBeNull();
    expect(container.firstElementChild).toBe(pre);
  });
});
