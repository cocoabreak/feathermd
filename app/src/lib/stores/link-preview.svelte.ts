import { invoke } from "@tauri-apps/api/core";
import { extractLinkPreview, type LinkPreviewContent } from "$lib/link-preview";
import type { DocumentRef } from "$lib/types";

const SHOW_DELAY_MS = 450;
const HIDE_DELAY_MS = 150;
const MAX_CACHE_ENTRIES = 32;

export const LINK_PREVIEW_TOOLTIP_ID = "link-preview-tooltip";

export interface LinkPreviewRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export type LinkPreviewReadResponse =
  | {
      status: "ready";
      rawPrefix: string;
      byteSize: number;
      truncated: boolean;
      sourceGeneration: number;
    }
  | { status: "missing"; sourceGeneration: number };

export interface LinkPreviewTarget {
  current: DocumentRef;
  target: DocumentRef;
  sourceGeneration: number;
  anchor: string | null;
  getRect: () => LinkPreviewRect | null;
  origin?: HTMLElement | null;
}

type PreviewReader = (
  current: DocumentRef,
  target: DocumentRef
) => Promise<LinkPreviewReadResponse>;

interface CachedPreview {
  rawPrefix: string;
  truncated: boolean;
}

function defaultReader(
  current: DocumentRef,
  target: DocumentRef
): Promise<LinkPreviewReadResponse> {
  return invoke<LinkPreviewReadResponse>("read_source_link_preview", { current, target });
}

function cacheKey(target: LinkPreviewTarget): string {
  return `${target.target.sourceId}:${target.sourceGeneration}:${target.target.path}`;
}

function toRect(rect: LinkPreviewRect): LinkPreviewRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export class LinkPreviewStore {
  status = $state<"idle" | "waiting" | "loading" | "ready" | "missing" | "error">("idle");
  content = $state<LinkPreviewContent | null>(null);
  path = $state("");
  rect = $state<LinkPreviewRect | null>(null);
  error = $state(false);
  private requestId = 0;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private currentTarget: LinkPreviewTarget | null = null;
  private rectProvider: (() => LinkPreviewRect | null) | null = null;
  private describedOrigin: HTMLElement | null = null;
  private cache = new Map<string, CachedPreview>();

  constructor(private readonly reader: PreviewReader = defaultReader) {}

  get visible(): boolean {
    return this.status !== "idle" && this.status !== "waiting";
  }

  syncScope(sourceId: string | null, generation: number | null): void {
    const prefix = sourceId === null || generation === null ? null : `${sourceId}:${generation}:`;
    for (const key of this.cache.keys()) {
      if (!prefix || !key.startsWith(prefix)) this.cache.delete(key);
    }
    const target = this.currentTarget;
    if (
      target &&
      (target.current.sourceId !== sourceId || target.sourceGeneration !== generation)
    ) {
      this.close();
    }
  }

  invalidateSource(sourceId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${sourceId}:`)) this.cache.delete(key);
    }
    if (this.currentTarget?.current.sourceId === sourceId) this.close();
  }

  invalidateAll(): void {
    this.cache.clear();
    this.close();
  }

  begin(target: LinkPreviewTarget, delay = SHOW_DELAY_MS): void {
    this.cancelShow();
    this.cancelHide();
    this.detachDescription();
    const requestId = ++this.requestId;
    this.currentTarget = target;
    this.rectProvider = target.getRect;
    this.path = target.target.path;
    this.content = null;
    this.error = false;
    this.rect = target.getRect();
    this.status = "waiting";
    this.describedOrigin = target.origin ?? null;
    this.attachDescription();
    this.showTimer = setTimeout(() => void this.load(target, requestId), delay);
  }

  beginPending(
    path: string,
    getRect: () => LinkPreviewRect | null,
    origin: HTMLElement | null,
    delay = SHOW_DELAY_MS
  ): void {
    this.cancelShow();
    this.cancelHide();
    this.detachDescription();
    const requestId = ++this.requestId;
    this.currentTarget = null;
    this.rectProvider = getRect;
    this.path = path;
    this.content = null;
    this.error = false;
    this.rect = getRect();
    this.status = "waiting";
    this.describedOrigin = origin;
    this.attachDescription();
    this.showTimer = setTimeout(() => {
      if (requestId === this.requestId) this.status = "loading";
    }, delay);
  }

  beginMissing(
    path: string,
    getRect: () => LinkPreviewRect | null,
    delay = SHOW_DELAY_MS,
    origin: HTMLElement | null = null
  ): void {
    this.cancelShow();
    this.cancelHide();
    this.detachDescription();
    const requestId = ++this.requestId;
    this.currentTarget = null;
    this.rectProvider = getRect;
    this.path = path;
    this.content = null;
    this.error = false;
    this.rect = getRect();
    this.status = "waiting";
    this.describedOrigin = origin;
    this.attachDescription();
    this.showTimer = setTimeout(() => {
      if (requestId === this.requestId) this.status = "missing";
    }, delay);
  }

  hide(delay = HIDE_DELAY_MS): void {
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.close(), delay);
  }

  keepOpen(): void {
    this.cancelHide();
  }

  refreshRect(): void {
    const next = this.rectProvider?.();
    if (next) this.rect = toRect(next);
  }

  close(): void {
    this.requestId++;
    this.cancelShow();
    this.cancelHide();
    this.detachDescription();
    this.currentTarget = null;
    this.rectProvider = null;
    this.status = "idle";
    this.content = null;
    this.rect = null;
    this.path = "";
    this.error = false;
  }

  private async load(target: LinkPreviewTarget, requestId: number): Promise<void> {
    if (requestId !== this.requestId) return;
    this.showTimer = null;
    this.rect = target.getRect();
    this.status = "loading";
    const key = cacheKey(target);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.applyReady(target, cached);
      return;
    }
    try {
      const response = await this.reader(target.current, target.target);
      if (requestId !== this.requestId) return;
      if (response.sourceGeneration !== target.sourceGeneration) {
        this.close();
        return;
      }
      if (response.status === "missing") {
        this.status = "missing";
        return;
      }
      const entry = { rawPrefix: response.rawPrefix, truncated: response.truncated };
      this.cache.set(key, entry);
      while (this.cache.size > MAX_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      this.applyReady(target, entry);
    } catch {
      if (requestId !== this.requestId) return;
      this.error = true;
      this.status = "error";
    }
  }

  private applyReady(target: LinkPreviewTarget, cached: CachedPreview): void {
    this.content = extractLinkPreview(
      cached.rawPrefix,
      target.target.path,
      target.anchor,
      cached.truncated
    );
    this.status = "ready";
  }

  private cancelShow(): void {
    if (this.showTimer) clearTimeout(this.showTimer);
    this.showTimer = null;
  }

  private cancelHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  private attachDescription(): void {
    if (!this.describedOrigin) return;
    const values = new Set(
      (this.describedOrigin.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
    );
    values.add(LINK_PREVIEW_TOOLTIP_ID);
    this.describedOrigin.setAttribute("aria-describedby", [...values].join(" "));
  }

  private detachDescription(): void {
    if (!this.describedOrigin) return;
    const values = (this.describedOrigin.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((value) => value && value !== LINK_PREVIEW_TOOLTIP_ID);
    if (values.length > 0) this.describedOrigin.setAttribute("aria-describedby", values.join(" "));
    else this.describedOrigin.removeAttribute("aria-describedby");
    this.describedOrigin = null;
  }
}

export const linkPreviewStore = new LinkPreviewStore();
