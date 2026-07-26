import { invoke } from "@tauri-apps/api/core";
import type { Locale } from "$lib/i18n/index.svelte";
import type { DocumentRef, DocumentSourceInfo } from "$lib/types";

export const LINK_GRAPH_WINDOW_LABEL = "link-graph";
export const LINK_GRAPH_OPEN_DOCUMENT_EVENT = "link-graph-open-document";

export interface LinkGraphWindowContext {
  document: DocumentRef;
  sourceGeneration: number;
  revision: number;
  showHiddenFiles: boolean;
  respectGitignore: boolean;
  includeWikiLinks: boolean;
  locale: Locale;
  dark: boolean;
}

export interface LinkGraphWindowSnapshot {
  contextVersion: number;
  context: LinkGraphWindowContext | null;
}

export interface LinkGraphWindowContextUpdate {
  sessionId: string;
  sequence: number;
  context: LinkGraphWindowContext | null;
}

export interface LinkGraphDocumentOpenRequest {
  contextVersion: number;
  origin: DocumentRef;
  target: DocumentRef;
}

export function isCurrentLinkGraphOpenRequest(
  request: LinkGraphDocumentOpenRequest,
  snapshot: LinkGraphWindowSnapshot
): boolean {
  const current = snapshot.context?.document;
  return (
    request.contextVersion === snapshot.contextVersion &&
    current !== undefined &&
    request.origin.sourceId === current.sourceId &&
    request.origin.path === current.path &&
    request.target.sourceId === current.sourceId
  );
}

export async function handleLinkGraphOpenRequest(
  request: LinkGraphDocumentOpenRequest,
  snapshot: LinkGraphWindowSnapshot,
  source: DocumentSourceInfo,
  open: (document: DocumentRef, source: DocumentSourceInfo) => Promise<unknown>,
  onError: (error: unknown, document: DocumentRef) => Promise<void> | void
): Promise<boolean> {
  if (!isCurrentLinkGraphOpenRequest(request, snapshot) || request.target.sourceId !== source.id) {
    return false;
  }
  try {
    await open(request.target, source);
    return true;
  } catch (error) {
    await onError(error, request.target);
    return false;
  }
}

export async function openLinkGraphWindow(): Promise<void> {
  await invoke("open_link_graph_window");
}
