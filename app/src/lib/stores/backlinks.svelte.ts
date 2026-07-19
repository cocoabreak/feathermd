import { invoke } from "@tauri-apps/api/core";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import { settingsStore } from "$lib/stores/settings.svelte";
import type { DocumentRef, DocumentSourceInfo } from "$lib/types";

export interface BacklinkResult {
  document: DocumentRef;
  filePath: string;
  referenceCount: number;
}

interface BacklinkResponse {
  results: BacklinkResult[];
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

export class BacklinksStore {
  results = $state<BacklinkResult[]>([]);
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
    this.results = [];
    this.isLoading = false;
    this.error = null;
    this.truncated = false;
  }

  async load(
    document: DocumentRef,
    source: DocumentSourceInfo,
    forceRefresh = false
  ): Promise<void> {
    const scope = [
      sourceScope(source),
      document.path,
      settingsStore.settings.showHiddenFiles,
      settingsStore.settings.respectGitignore,
    ].join(":");
    const refresh = forceRefresh || this.dirty;
    if (!refresh && this.resultScope === scope && !this.runner) return;

    this.queuedLoad = {
      id: ++this.requestId,
      document,
      scope,
      refresh,
    };
    if (!this.runner) {
      const runner = this.runQueue();
      this.runner = runner;
      void runner.then(
        () => {
          if (this.runner === runner) this.runner = null;
        },
        () => {
          if (this.runner === runner) this.runner = null;
        }
      );
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
    const { id: requestId, document, scope, refresh } = request;
    this.isLoading = true;
    this.error = null;
    this.truncated = false;
    this.results = [];
    try {
      const response = await invoke<BacklinkResponse>("list_source_backlinks", {
        document,
        showHiddenFiles: settingsStore.settings.showHiddenFiles,
        respectGitignore: settingsStore.settings.respectGitignore,
        forceRefresh: refresh,
      });
      if (requestId !== this.requestId) return;
      this.results = response.results;
      this.truncated = response.truncated;
      this.resultScope = scope;
      this.dirty = false;
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.error = String(error);
      this.resultScope = scope;
    } finally {
      if (requestId === this.requestId) this.isLoading = false;
    }
  }

  async open(result: BacklinkResult, source: DocumentSourceInfo): Promise<boolean> {
    if (result.document.sourceId !== source.id) return false;
    try {
      return await openSourceMarkdown(result.document, source);
    } catch (error) {
      this.error = String(error);
      return false;
    }
  }
}

export const backlinksStore = new BacklinksStore();
