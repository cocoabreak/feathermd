const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

const RESET_DELAY_MS = 1500;

export interface CodeCopyLabels {
  copy: string;
  copied: string;
}

function setButtonState(button: HTMLButtonElement, labels: CodeCopyLabels, copied: boolean): void {
  button.replaceChildren();

  const icon = document.createElement("span");
  icon.className = "code-copy-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = copied ? CHECK_ICON : COPY_ICON;
  button.appendChild(icon);

  if (copied) {
    const message = document.createElement("span");
    message.className = "code-copy-message";
    message.textContent = labels.copied;
    button.appendChild(message);
  }

  const label = copied ? labels.copied : labels.copy;
  button.classList.toggle("code-copy-success", copied);
  button.setAttribute("aria-label", label);
  button.title = label;
}

/**
 * コンテナ内の pre.shiki をラップしてコピーボタンを追加する。
 * @returns ボタン、イベント、タイマーを解除するクリーンアップ関数
 */
export function setupCodeCopy(container: HTMLElement, labels: CodeCopyLabels): () => void {
  const blocks = container.querySelectorAll<HTMLPreElement>("pre.shiki");
  const cleanups: Array<() => void> = [];

  blocks.forEach((pre) => {
    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";
    pre.parentElement?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy-button";
    button.setAttribute("aria-live", "polite");
    setButtonState(button, labels, false);

    let disposed = false;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const handleClick = async () => {
      const text = pre.querySelector("code")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
        if (disposed) return;

        clearTimeout(resetTimer);
        setButtonState(button, labels, true);
        resetTimer = setTimeout(() => setButtonState(button, labels, false), RESET_DELAY_MS);
      } catch (e) {
        console.warn("clipboard write failed:", e);
      }
    };
    button.addEventListener("click", handleClick);

    wrapper.appendChild(button);

    cleanups.push(() => {
      disposed = true;
      clearTimeout(resetTimer);
      button.removeEventListener("click", handleClick);
      if (wrapper.isConnected) wrapper.replaceWith(pre);
    });
  });

  return () => cleanups.forEach((cleanup) => cleanup());
}
