export interface FocusTrapOptions {
  onEscape: () => void;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusableElements(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true"
  );
}

export function focusTrap(node: HTMLElement, initial: FocusTrapOptions) {
  let options = initial;
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  queueMicrotask(() => {
    if (!node.isConnected) return;
    (getFocusableElements(node)[0] ?? node).focus();
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      options.onEscape();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(node);
    if (focusable.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  node.addEventListener("keydown", handleKeydown);
  return {
    update(next: FocusTrapOptions) {
      options = next;
    },
    destroy() {
      node.removeEventListener("keydown", handleKeydown);
      if (previousFocus?.isConnected) previousFocus.focus();
    },
  };
}
