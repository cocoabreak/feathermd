import type {
  DocumentLinkEdge,
  DocumentLinkKind,
  LinkContextSection,
} from "$lib/stores/links.svelte";
import type { DocumentRef } from "$lib/types";
import { basename } from "$lib/utils";

export type LinkGraphNodeKind = "current" | "incoming" | "outgoing" | "both" | "broken";

export interface LinkGraphNode {
  id: string;
  label: string;
  path: string;
  kind: LinkGraphNodeKind;
  document: DocumentRef | null;
  x: number;
  y: number;
}

export interface LinkGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: DocumentLinkKind;
}

export interface LinkGraph {
  nodes: LinkGraphNode[];
  edges: LinkGraphEdge[];
  omitted: number | null;
}

const MAX_NODES = 40;
const COLUMN_X: Record<LinkGraphNodeKind, number> = {
  incoming: 90,
  both: 270,
  current: 400,
  outgoing: 610,
  broken: 610,
};

interface NodeDraft {
  id: string;
  path: string;
  kind: LinkGraphNodeKind;
  document: DocumentRef | null;
}

function documentId(document: DocumentRef): string {
  return `document:${document.sourceId}:${document.path}`;
}

function brokenId(edge: DocumentLinkEdge): string {
  return `broken:${edge.kind}:${edge.rawTarget ?? ""}:${edge.anchor ?? ""}`;
}

function complete(section: LinkContextSection): boolean {
  return section.total !== null && section.total === section.items.length;
}

export function buildLinkGraph(
  current: DocumentRef,
  outgoing: LinkContextSection,
  incoming: LinkContextSection,
  broken: LinkContextSection
): LinkGraph {
  const currentId = documentId(current);
  const drafts = new Map<string, NodeDraft>();
  const edgeDrafts: Omit<LinkGraphEdge, "id">[] = [];
  drafts.set(currentId, {
    id: currentId,
    path: current.path,
    kind: "current",
    document: current,
  });

  for (const edge of incoming.items) {
    const id = documentId(edge.source);
    if (id === currentId) {
      edgeDrafts.push({ from: currentId, to: currentId, kind: edge.kind });
      continue;
    }
    const existing = drafts.get(id);
    drafts.set(id, {
      id,
      path: edge.source.path,
      kind: existing?.kind === "outgoing" ? "both" : (existing?.kind ?? "incoming"),
      document: edge.source,
    });
    edgeDrafts.push({ from: id, to: currentId, kind: edge.kind });
  }
  for (const edge of outgoing.items) {
    if (!edge.target) continue;
    const id = documentId(edge.target);
    if (id === currentId) {
      edgeDrafts.push({ from: currentId, to: currentId, kind: edge.kind });
      continue;
    }
    const existing = drafts.get(id);
    drafts.set(id, {
      id,
      path: edge.target.path,
      kind: existing?.kind === "incoming" ? "both" : (existing?.kind ?? "outgoing"),
      document: edge.target,
    });
    edgeDrafts.push({ from: currentId, to: id, kind: edge.kind });
  }
  for (const edge of broken.items) {
    const id = brokenId(edge);
    if (!drafts.has(id)) {
      drafts.set(id, {
        id,
        path: edge.rawTarget ?? "",
        kind: "broken",
        document: null,
      });
    }
    edgeDrafts.push({ from: currentId, to: id, kind: edge.kind });
  }

  const allRelated = [...drafts.values()]
    .filter((node) => node.kind !== "current")
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
  const selected = [drafts.get(currentId)!, ...allRelated.slice(0, MAX_NODES - 1)];
  const selectedIds = new Set(selected.map((node) => node.id));
  const columns = new Map<LinkGraphNodeKind, NodeDraft[]>();
  for (const node of selected) {
    const column = columns.get(node.kind) ?? [];
    column.push(node);
    columns.set(node.kind, column);
  }
  const nodes = selected.map<LinkGraphNode>((node) => {
    const column = columns.get(node.kind) ?? [];
    const index = column.findIndex((candidate) => candidate.id === node.id);
    const spacing = Math.min(66, 340 / Math.max(column.length - 1, 1));
    return {
      ...node,
      label: basename(node.path) || node.path,
      x: COLUMN_X[node.kind],
      y: column.length === 1 ? 210 : 40 + index * spacing,
    };
  });
  const edges = edgeDrafts
    .filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))
    .map((edge, index) => ({ ...edge, id: `${edge.from}:${edge.to}:${edge.kind}:${index}` }));
  const isComplete = complete(outgoing) && complete(incoming) && complete(broken);
  return {
    nodes,
    edges,
    omitted: isComplete ? Math.max(0, drafts.size - selected.length) : null,
  };
}
