import { resolveSourceRelativeMarkdownTarget } from "$lib/document-sources";
import {
  getWikiLinkTarget,
  watchWikiLinkTarget,
  type WikiLinkTargetState,
} from "$lib/plugins/wiki-links";
import {
  LinkPreviewStore,
  linkPreviewStore,
  type LinkPreviewTarget,
} from "$lib/stores/link-preview.svelte";
import type { DocumentRef } from "$lib/types";

const POINTER_DELAY_MS = 450;

export interface LinkPreviewTriggerContext {
  current: DocumentRef;
  sourceGeneration: number;
  store?: LinkPreviewStore;
}

function anchorFromEvent(
  container: HTMLElement,
  target: EventTarget | null
): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest<HTMLAnchorElement>("a");
  return anchor && container.contains(anchor) ? anchor : null;
}

function rectProvider(anchor: HTMLAnchorElement) {
  return () => (anchor.isConnected ? anchor.getBoundingClientRect() : null);
}

function markdownTarget(
  anchor: HTMLAnchorElement,
  current: DocumentRef
): { document: DocumentRef; anchor: string | null } | null {
  if (anchor.classList.contains("wiki-link")) return null;
  const href = anchor.getAttribute("href") ?? "";
  const resolved = resolveSourceRelativeMarkdownTarget(current, href);
  if (!resolved || resolved.document.path === current.path) return null;
  return resolved;
}

export function setupLinkPreviewTrigger(
  container: HTMLElement,
  context: LinkPreviewTriggerContext
): () => void {
  const store = context.store ?? linkPreviewStore;
  store.syncScope(context.current.sourceId, context.sourceGeneration);
  let activeAnchor: HTMLAnchorElement | null = null;
  let stopWatching: (() => void) | null = null;
  let startedAt = 0;
  let pointerActive = false;
  let focusActive = false;

  function clearWatcher(): void {
    stopWatching?.();
    stopWatching = null;
  }

  function stillActive(anchor: HTMLAnchorElement): boolean {
    return activeAnchor === anchor && (pointerActive || focusActive);
  }

  function showResolved(
    anchor: HTMLAnchorElement,
    document: DocumentRef,
    heading: string | null,
    delay: number
  ): void {
    const target: LinkPreviewTarget = {
      current: context.current,
      target: document,
      sourceGeneration: context.sourceGeneration,
      anchor: heading,
      getRect: rectProvider(anchor),
      origin: anchor,
    };
    store.begin(target, delay);
  }

  function applyWikiState(
    anchor: HTMLAnchorElement,
    state: WikiLinkTargetState,
    delay: number
  ): void {
    if (!stillActive(anchor)) return;
    if (state.status === "resolved") {
      showResolved(anchor, state.document, state.anchor, delay);
    } else if (state.status === "missing") {
      store.beginMissing(anchor.dataset.wikiTarget ?? "", rectProvider(anchor), delay, anchor);
    } else {
      store.beginPending(anchor.dataset.wikiTarget ?? "", rectProvider(anchor), anchor, delay);
    }
  }

  function start(anchor: HTMLAnchorElement, keyboard: boolean): void {
    if (activeAnchor !== anchor) {
      clearWatcher();
      activeAnchor = anchor;
      startedAt = Date.now();
    }
    const delay = keyboard ? 0 : POINTER_DELAY_MS;
    if (anchor.classList.contains("wiki-link")) {
      const state = getWikiLinkTarget(anchor);
      if (!state) return;
      applyWikiState(anchor, state, delay);
      clearWatcher();
      stopWatching = watchWikiLinkTarget(anchor, (next) => {
        const remaining = keyboard ? 0 : Math.max(0, POINTER_DELAY_MS - (Date.now() - startedAt));
        applyWikiState(anchor, next, remaining);
      });
      return;
    }
    const resolved = markdownTarget(anchor, context.current);
    if (resolved) showResolved(anchor, resolved.document, resolved.anchor, delay);
  }

  function leave(anchor: HTMLAnchorElement): void {
    if (activeAnchor !== anchor || pointerActive || focusActive) return;
    clearWatcher();
    activeAnchor = null;
    store.hide();
  }

  function onPointerOver(event: PointerEvent): void {
    const anchor = anchorFromEvent(container, event.target);
    if (!anchor) return;
    if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
    pointerActive = true;
    start(anchor, false);
  }

  function onPointerOut(event: PointerEvent): void {
    const anchor = anchorFromEvent(container, event.target);
    if (!anchor || anchor !== activeAnchor) return;
    if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
    pointerActive = false;
    leave(anchor);
  }

  function onFocusIn(event: FocusEvent): void {
    const anchor = anchorFromEvent(container, event.target);
    if (!anchor) return;
    focusActive = true;
    start(anchor, true);
  }

  function onFocusOut(event: FocusEvent): void {
    const anchor = anchorFromEvent(container, event.target);
    if (!anchor || anchor !== activeAnchor) return;
    if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
    focusActive = false;
    leave(anchor);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && store.visible) {
      store.close();
      event.stopPropagation();
    }
  }

  container.addEventListener("pointerover", onPointerOver);
  container.addEventListener("pointerout", onPointerOut);
  container.addEventListener("focusin", onFocusIn);
  container.addEventListener("focusout", onFocusOut);
  container.addEventListener("keydown", onKeyDown);
  return () => {
    clearWatcher();
    store.close();
    container.removeEventListener("pointerover", onPointerOver);
    container.removeEventListener("pointerout", onPointerOut);
    container.removeEventListener("focusin", onFocusIn);
    container.removeEventListener("focusout", onFocusOut);
    container.removeEventListener("keydown", onKeyDown);
  };
}
