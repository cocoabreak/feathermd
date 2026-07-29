import type { DocumentRef, DocumentSourceInfo, TocHeading } from "$lib/types";
import { displayDocumentPath, nativeDocumentPath } from "$lib/document-sources";
import { normalizePath } from "$lib/utils";

export type ReferenceFormat =
  "wiki" | "markdown" | "path" | "heading-wiki" | "heading-markdown" | "heading-name";

export interface ReferenceTarget {
  document: DocumentRef;
  source: DocumentSourceInfo;
  title: string;
  heading?: TocHeading | null;
}

function sourcePath(document: DocumentRef): string {
  return normalizePath(document.path).replace(/^\/+/, "");
}

function documentLabel(target: ReferenceTarget): string {
  const name = sourcePath(target.document).split("/").at(-1) || target.title;
  return name.replace(/\.(?:md|markdown)$/i, "") || target.title;
}

function escapeMarkdownLabel(value: string): string {
  if (value.includes("\0")) throw new Error("unsupported-markdown-label");
  return value.replace(/\r\n?|\n/g, " ").replace(/([\\[\]<>])/g, "\\$1");
}

function markdownDestination(path: string, anchor?: string): string {
  if (/[<>\r\n\0]/.test(path)) {
    throw new Error("unsupported-markdown-target");
  }
  const encodedPath = path.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F");
  const target = `/${encodedPath}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
  return `<${target}>`;
}

function wikiDestination(path: string, anchor?: string): string {
  const unsupported = ["[", "]", "|", "#", "\r", "\n", "\0"];
  if (
    unsupported.some((character) => path.includes(character)) ||
    (anchor !== undefined && unsupported.some((character) => anchor.includes(character)))
  ) {
    throw new Error("unsupported-wiki-target");
  }
  return `${path}${anchor ? `#${anchor}` : ""}`;
}

function requiredHeading(target: ReferenceTarget): TocHeading {
  if (!target.heading) throw new Error("heading-required");
  return target.heading;
}

export function formatReference(format: ReferenceFormat, target: ReferenceTarget): string {
  const path = sourcePath(target.document);
  if (!path) throw new Error("document-path-required");
  const label = escapeMarkdownLabel(documentLabel(target));

  switch (format) {
    case "wiki":
      return `[[${wikiDestination(path)}]]`;
    case "markdown":
      return `[${label}](${markdownDestination(path)})`;
    case "path":
      return target.source.kind === "native"
        ? (nativeDocumentPath(target.source, target.document) ??
            displayDocumentPath(target.source, target.document))
        : displayDocumentPath(target.source, target.document);
    case "heading-wiki": {
      const heading = requiredHeading(target);
      return `[[${wikiDestination(path, heading.id)}]]`;
    }
    case "heading-markdown": {
      const heading = requiredHeading(target);
      const headingLabel = escapeMarkdownLabel(heading.text);
      return `[${label} — ${headingLabel}](${markdownDestination(path, heading.id)})`;
    }
    case "heading-name":
      return requiredHeading(target).text;
  }
}
