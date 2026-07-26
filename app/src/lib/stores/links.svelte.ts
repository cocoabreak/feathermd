import { invoke } from "@tauri-apps/api/core";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import { settingsStore } from "$lib/stores/settings.svelte";
import type { DocumentRef, DocumentSourceInfo } from "$lib/types";

export type DocumentLinkKind = "wiki" | "markdown";

export interface DocumentLinkEdge {
  source: DocumentRef;
  target: DocumentRef | null;
  rawTarget: string | null;
  anchor: string | null;
  kind: DocumentLinkKind;
  referenceCount: number;
}

export interface LinkContextSection {
  items: DocumentLinkEdge[];
  total: number | null;
}

export interface LinkContextResponse {
  outgoing: LinkContextSection;
  incoming: LinkContextSection;
  broken: LinkContextSection;
  truncated: boolean;
}

interface PendingLoad {
  id: number;
  document: DocumentRef;
  scope: string;
  refresh: boolean;
}

function sourceScope(source: DocumentSourceInfo): string {
  return `${source.id}:${source.generation ?? 0}`;
}

const EMPTY_SECTION = (): LinkContextSection => ({ items: [], total: 0 });

export class LinkInspectorStore {
  outgoing = $state<LinkContextSection>(EMPTY_SECTION());
  incoming = $state<LinkContextSection>(EMPTY_SECTION());
  broken = $state<LinkContextSection>(EMPTY_SECTION());
  isLoading = $state(false);
  error = $state<string | null>(null);
  truncated = $state(false);
  revision = $state(0);
  private requestId = 0;
  private resultScope: string | null = null;
  private dirty = false;
  private queuedLoad: PendingLoad | null = null;
  private runner: Promise<void> | null = null;

  invalidate() {
    this.dirty = true;
    this.revision++;
  }

  clear() {
    this.requestId++;
    this.queuedLoad = null;
    this.resultScope = null;
    this.outgoing = EMPTY_SECTION();
    this.incoming = EMPTY_SECTION();
    this.broken = EMPTY_SECTION();
    this.isLoading = false;
    this.error = null;
    this.truncated = false;
  }

  async load(
    document: DocumentRef,
    source: DocumentSourceInfo,
    forceRefresh = false
  ): Promise<void> {
    const includeWikiLinks = settingsStore.settings.renderers["wiki-links"] === true;
    const scope = [
      sourceScope(source),
      document.path,
      settingsStore.settings.showHiddenFiles,
      settingsStore.settings.respectGitignore,
      includeWikiLinks,
    ].join(":");
    const refresh = forceRefresh || this.dirty;
    if (!refresh && this.resultScope === scope && !this.runner) return;

    this.queuedLoad = { id: ++this.requestId, document, scope, refresh };
    if (!this.runner) {
      const runner = this.runQueue();
      this.runner = runner;
      void runner.finally(() => {
        if (this.runner === runner) this.runner = null;
      });
    }
    await this.runner;
  }

  private async runQueue(): Promise<void> {
    while (this.queuedLoad) {
      const request = this.queuedLoad;
      this.queuedLoad = null;
      await this.execute(request);
    }
  }

  private async execute(request: PendingLoad): Promise<void> {
    const { id, document, scope, refresh } = request;
    this.isLoading = true;
    this.error = null;
    try {
      const response = await invoke<LinkContextResponse>("get_source_link_context", {
        document,
        showHiddenFiles: settingsStore.settings.showHiddenFiles,
        respectGitignore: settingsStore.settings.respectGitignore,
        includeWikiLinks: settingsStore.settings.renderers["wiki-links"] === true,
        forceRefresh: refresh,
      });
      if (id !== this.requestId) return;
      this.outgoing = response.outgoing;
      this.incoming = response.incoming;
      this.broken = response.broken;
      this.truncated = response.truncated;
      this.resultScope = scope;
      this.dirty = false;
    } catch (error) {
      if (id !== this.requestId) return;
      this.error = String(error);
      this.resultScope = scope;
    } finally {
      if (id === this.requestId) this.isLoading = false;
    }
  }

  async openDocument(document: DocumentRef | null, source: DocumentSourceInfo): Promise<boolean> {
    if (!document || document.sourceId !== source.id) return false;
    try {
      return await openSourceMarkdown(document, source);
    } catch (error) {
      this.error = String(error);
      return false;
    }
  }
}

export const linkInspectorStore = new LinkInspectorStore();
