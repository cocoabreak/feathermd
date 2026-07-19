import { lightboxStore } from "$lib/stores/lightbox.svelte";

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/></svg>`;

function createExpandButton(onOpen: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lightbox-trigger-button";
  button.innerHTML = EXPAND_ICON;
  button.setAttribute("aria-label", "拡大表示");
  button.addEventListener("click", (e) => {
    // 画像がリンクで囲まれている場合、リンク遷移よりライトボックス表示を優先する
    e.preventDefault();
    e.stopPropagation();
    onOpen();
  });
  return button;
}

/**
 * コンテナ内の img を inline-block のラッパーspanで包み、展開アイコンを追加する。
 * バッジ画像等の横並び表示（display: inline）を崩さないよう、ラッパーはblockにしない。
 * @returns クリーンアップ関数（現状は解除不要のリスナーのみのため no-op）
 */
export function setupImageLightboxTrigger(container: HTMLElement): () => void {
  container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const wrapper = document.createElement("span");
    wrapper.className = "lightbox-trigger-wrapper";
    img.parentElement?.insertBefore(wrapper, img);
    wrapper.appendChild(img);
    wrapper.appendChild(createExpandButton(() => lightboxStore.openImage(img.src, img.alt)));
  });

  return () => {};
}

/** Mermaidが遅延レンダリングされた直後に plugins/mermaid/post.ts から呼び出し、展開アイコンを追加する */
export function addMermaidExpandButton(mermaidEl: HTMLElement): void {
  const svg = mermaidEl.querySelector("svg");
  if (!svg) return;
  mermaidEl.appendChild(createExpandButton(() => lightboxStore.openSvg(svg.outerHTML)));
}
