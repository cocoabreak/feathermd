import { invoke } from "@tauri-apps/api/core";
import { explorerStore } from "./explorer.svelte";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import { searchStore } from "./search.svelte";
import { settingsStore } from "./settings.svelte";
import type { DocumentRef, DocumentSourceInfo } from "$lib/types";

export interface SearchMatch {
  line_number: number;
  line_text: string;
}

export interface SearchResult {
  filePath: string;
  document: DocumentRef;
  matches: SearchMatch[];
}

interface SearchResponse {
  results: SearchResult[];
  truncated: boolean;
  cancelled: boolean;
}

export class GlobalSearchStore {
  query = $state("");
  isRegex = $state(false);
  caseSensitive = $state(false);
  results = $state<SearchResult[]>([]);
  isSearching = $state(false);
  error = $state<string | null>(null);
  truncated = $state(false);
  focusTick = $state(0);
  private requestId = 0;
  private sourceScope: string | null = null;

  openSearch() {
    this.focusTick++;
  }

  syncSource(source: DocumentSourceInfo | null) {
    const scope = source ? `${source.id}:${source.generation ?? 0}` : null;
    if (this.sourceScope === scope) return;
    this.requestId++;
    this.sourceScope = scope;
    this.results = [];
    this.isSearching = false;
    this.error = null;
    this.truncated = false;
  }

  async search() {
    this.syncSource(explorerStore.source);
    if (!this.query || !explorerStore.rootPath) {
      this.results = [];
      return;
    }

    const requestId = ++this.requestId;
    const query = this.query;
    this.isSearching = true;
    this.error = null;
    this.truncated = false;
    this.results = [];

    try {
      const source = explorerStore.source;
      if (!source) return;
      const sourceScope = `${source.id}:${source.generation ?? 0}`;
      const response: SearchResponse = await invoke("search_source", {
        requestId,
        sourceId: source.id,
        options: {
          query,
          isRegex: this.isRegex,
          caseSensitive: this.caseSensitive,
          showHiddenFiles: settingsStore.settings.showHiddenFiles,
          respectGitignore: settingsStore.settings.respectGitignore,
        },
      });
      if (
        requestId !== this.requestId ||
        response.cancelled ||
        `${explorerStore.source?.id}:${explorerStore.source?.generation ?? 0}` !== sourceScope
      )
        return;
      this.results = response.results;
      this.truncated = response.truncated;
    } catch (err) {
      if (requestId !== this.requestId) return;
      this.error = String(err);
    } finally {
      if (requestId === this.requestId) this.isSearching = false;
    }
  }

  clear() {
    this.requestId++;
    this.query = "";
    this.results = [];
    this.error = null;
    this.truncated = false;
  }

  async openMatch(result: SearchResult, lineNumber: number): Promise<boolean> {
    // 1. ファイルを開く
    const source = explorerStore.source;
    const sourceScope = source ? `${source.id}:${source.generation ?? 0}` : null;
    if (!source || result.document.sourceId !== source.id || this.sourceScope !== sourceScope)
      return false;
    try {
      await openSourceMarkdown(result.document, source);
    } catch (error) {
      this.error = String(error);
      return false;
    }

    // 2. ページ内検索のUIを開き、マッチしたキーワードをセットする
    searchStore.openSearch();
    // もし正規表現モードなら検索文字列として正規表現の構文がそのまま入るため
    // ページ内検索も正規表現モードにする
    searchStore.setRegex(this.isRegex);
    // 該当行にジャンプするための行番号をセット
    searchStore.setTargetLine(lineNumber);
    // クエリを更新（更新されるとページ内の該当箇所にスクロール＆ハイライトされる）
    searchStore.setQuery(this.query);
    return true;
  }
}

export const globalSearchStore = new GlobalSearchStore();
