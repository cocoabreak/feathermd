import { invoke } from "@tauri-apps/api/core";
import { openSourceMarkdown } from "$lib/actions/file-actions";
import { settingsStore } from "$lib/stores/settings.svelte";
import { withReferenceHeadingIds } from "$lib/stores/toc.svelte";
import { headingReferenceMatches } from "$lib/markdown/heading-anchor";
import type { DocumentRef, DocumentSourceInfo, SafeOutlineHeading } from "$lib/types";

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

export type ReferenceProblemStatus = "missing" | "outsideSource" | "unverifiable";
export type ReferenceProblemKind = "document" | "image" | "heading";

export interface SourceReferenceProblem {
  kind: "image";
  rawTarget: string;
  status: ReferenceProblemStatus;
  referenceCount: number;
}

export interface HeadingValidationReference {
  document: DocumentRef;
  rawTarget: string;
  anchor: string;
  kind: DocumentLinkKind;
  referenceCount: number;
}

export interface HeadingValidationDocument {
  document: DocumentRef;
  headings: SafeOutlineHeading[];
  complete: boolean;
}

export interface ReferenceValidationResponse {
  imageProblems: SourceReferenceProblem[];
  headingReferences: HeadingValidationReference[];
  headingDocuments: HeadingValidationDocument[];
  truncated: boolean;
}

export interface ReferenceProblem {
  kind: ReferenceProblemKind;
  status: ReferenceProblemStatus;
  rawTarget: string;
  document: DocumentRef | null;
  anchor: string | null;
  linkKind: DocumentLinkKind | null;
  referenceCount: number;
}

export interface ReferenceProblemSection {
  items: ReferenceProblem[];
  total: number | null;
}

function documentKey(document: DocumentRef): string {
  return `${document.sourceId}:${document.path}`;
}

export function buildReferenceProblems(
  broken: LinkContextSection,
  validation: ReferenceValidationResponse
): ReferenceProblemSection {
  const problems: ReferenceProblem[] = broken.items.map((edge) => ({
    kind: "document",
    status: "missing",
    rawTarget: edge.rawTarget ?? "",
    document: null,
    anchor: edge.anchor,
    linkKind: edge.kind,
    referenceCount: edge.referenceCount,
  }));
  problems.push(
    ...validation.imageProblems.map((problem) => ({
      kind: "image" as const,
      status: problem.status,
      rawTarget: problem.rawTarget,
      document: null,
      anchor: null,
      linkKind: null,
      referenceCount: problem.referenceCount,
    }))
  );

  const outlines = new Map(
    validation.headingDocuments.map((entry) => {
      const headings = withReferenceHeadingIds(entry.headings).map((heading) => ({
        id: heading.referenceId ?? heading.id,
        text: heading.anchorText ?? heading.text,
      }));
      return [documentKey(entry.document), { headings, complete: entry.complete }] as const;
    })
  );
  for (const reference of validation.headingReferences) {
    const outline = outlines.get(documentKey(reference.document));
    if (
      outline?.headings.some((heading) =>
        headingReferenceMatches(reference.anchor, heading.id, heading.text)
      )
    ) {
      continue;
    }
    problems.push({
      kind: "heading",
      status: outline?.complete ? "missing" : "unverifiable",
      rawTarget: reference.rawTarget || reference.document.path,
      document: reference.document,
      anchor: reference.anchor,
      linkKind: reference.kind,
      referenceCount: reference.referenceCount,
    });
  }
  problems.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.rawTarget.localeCompare(right.rawTarget) ||
      (left.anchor ?? "").localeCompare(right.anchor ?? "")
  );
  const responseTruncated = validation.truncated || broken.total === null;
  const items = problems.slice(0, 500);
  return {
    items,
    total: responseTruncated || items.length < problems.length ? null : problems.length,
  };
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
const EMPTY_PROBLEM_SECTION = (): ReferenceProblemSection => ({ items: [], total: 0 });

export class LinkInspectorStore {
  outgoing = $state<LinkContextSection>(EMPTY_SECTION());
  incoming = $state<LinkContextSection>(EMPTY_SECTION());
  broken = $state<LinkContextSection>(EMPTY_SECTION());
  problems = $state<ReferenceProblemSection>(EMPTY_PROBLEM_SECTION());
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
    this.problems = EMPTY_PROBLEM_SECTION();
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
      const includeWikiLinks = settingsStore.settings.renderers["wiki-links"] === true;
      const response = await invoke<LinkContextResponse>("get_source_link_context", {
        document,
        showHiddenFiles: settingsStore.settings.showHiddenFiles,
        respectGitignore: settingsStore.settings.respectGitignore,
        includeWikiLinks,
        forceRefresh: refresh,
      });
      if (id !== this.requestId) return;
      const validation = await invoke<ReferenceValidationResponse>(
        "get_source_reference_validation",
        {
          document,
          respectGitignore: settingsStore.settings.respectGitignore,
          includeWikiLinks,
        }
      );
      if (id !== this.requestId) return;
      this.outgoing = response.outgoing;
      this.incoming = response.incoming;
      this.broken = response.broken;
      this.problems = buildReferenceProblems(response.broken, validation);
      this.truncated = response.truncated || validation.truncated;
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
