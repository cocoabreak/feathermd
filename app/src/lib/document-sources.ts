import { invoke } from "@tauri-apps/api/core";
import type { DocumentRef, DocumentSourceInfo, FileEntry } from "$lib/types";
import { normalizePath } from "$lib/utils";

interface RememberedDocument {
  document: DocumentRef;
  source: DocumentSourceInfo;
}

const rememberedDocuments = new Map<string, RememberedDocument>();

export function documentKey(document: DocumentRef): string {
  return `${document.sourceId}:${encodeURIComponent(document.path)}`;
}

export function rootDocument(source: DocumentSourceInfo): DocumentRef {
  return { sourceId: source.id, path: "" };
}

export function displayDocumentPath(source: DocumentSourceInfo, document: DocumentRef): string {
  if (source.kind === "native") {
    return document.path
      ? `${normalizePath(source.nativePath)}/${document.path}`
      : source.nativePath;
  }
  return document.path ? `${source.nativePath} / ${document.path}` : source.nativePath;
}

export function nativeDocumentPath(
  source: DocumentSourceInfo,
  document: DocumentRef
): string | null {
  if (source.kind !== "native") return null;
  return document.path
    ? `${normalizePath(source.nativePath).replace(/\/$/, "")}/${document.path}`
    : normalizePath(source.nativePath);
}

function nativeComparisonPath(path: string): string {
  const normalized = normalizePath(path);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

export function nativePathsEqual(left: string, right: string): boolean {
  return nativeComparisonPath(left) === nativeComparisonPath(right);
}

/** 同じネイティブファイルを異なるSource IDから開いた場合も一意に比較するためのキー。 */
export function nativeDocumentIdentity(
  source: DocumentSourceInfo,
  document: DocumentRef
): string | null {
  const path = nativeDocumentPath(source, document);
  return path === null ? null : nativeComparisonPath(path);
}

export function isSameNativeDocument(
  leftSource: DocumentSourceInfo,
  leftDocument: DocumentRef,
  rightSource: DocumentSourceInfo,
  rightDocument: DocumentRef
): boolean {
  const left = nativeDocumentIdentity(leftSource, leftDocument);
  return left !== null && left === nativeDocumentIdentity(rightSource, rightDocument);
}

export function nativePathToDocument(source: DocumentSourceInfo, path: string): DocumentRef | null {
  if (source.kind !== "native") return null;
  const root = normalizePath(source.nativePath).replace(/\/$/, "");
  const normalized = normalizePath(path);
  const comparableRoot = nativeComparisonPath(root);
  const comparablePath = nativeComparisonPath(normalized);
  if (comparablePath === comparableRoot) return { sourceId: source.id, path: "" };
  if (!comparablePath.startsWith(`${comparableRoot}/`)) return null;
  return { sourceId: source.id, path: normalized.slice(root.length + 1) };
}

export function rememberDocument(document: DocumentRef, source: DocumentSourceInfo): void {
  rememberedDocuments.set(documentKey(document), { document, source });
}

export function getRememberedDocument(key: string): RememberedDocument | undefined {
  return rememberedDocuments.get(key);
}

export function resolveDocumentPath(base: DocumentRef, target: string): DocumentRef | null {
  const normalizedTarget = normalizePath(target);
  if (
    normalizedTarget.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedTarget) ||
    normalizedTarget.startsWith("//")
  ) {
    return null;
  }
  const parts = [...base.path.split("/").slice(0, -1), ...normalizedTarget.split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return { sourceId: base.sourceId, path: resolved.join("/") };
}

export function resolveDocumentTarget(
  source: DocumentSourceInfo,
  base: DocumentRef,
  target: string
): DocumentRef | null {
  const normalizedTarget = normalizePath(target);
  if (
    source.kind === "native" &&
    (/^[A-Za-z]:\//.test(normalizedTarget) || normalizedTarget.startsWith("/"))
  ) {
    const root = normalizePath(source.nativePath).replace(/\/$/, "");
    const comparableTarget = nativeComparisonPath(normalizedTarget);
    const comparableRoot = nativeComparisonPath(root);
    if (comparableTarget === comparableRoot) return { sourceId: source.id, path: "" };
    if (comparableTarget.startsWith(`${comparableRoot}/`)) {
      return { sourceId: source.id, path: normalizedTarget.slice(root.length + 1) };
    }
    return null;
  }
  return resolveDocumentPath(base, target);
}

export async function registerNativeSource(rootPath: string): Promise<DocumentSourceInfo> {
  return invoke("register_native_source", { rootPath });
}

export async function registerNativeDocument(
  path: string
): Promise<[DocumentSourceInfo, DocumentRef]> {
  return invoke("register_native_document_source", { path });
}

export async function registerZipSource(archivePath: string): Promise<DocumentSourceInfo> {
  return invoke("register_zip_source", { archivePath });
}

export async function listSourceEntries(
  document: DocumentRef,
  respectGitignore: boolean
): Promise<FileEntry[]> {
  return invoke("list_source_entries", { document, respectGitignore });
}

export async function listSourceMarkdownDocuments(
  sourceId: string,
  showHiddenFiles: boolean,
  respectGitignore: boolean
): Promise<DocumentRef[]> {
  return invoke("list_source_markdown_documents", {
    sourceId,
    showHiddenFiles,
    respectGitignore,
  });
}
