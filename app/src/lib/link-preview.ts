import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { extractFrontmatter } from "$lib/markdown/frontmatter";
import { basename } from "$lib/utils";

const MAX_TEXT_CHARS = 256;
const MAX_METADATA_ITEMS = 32;
const MAX_METADATA_BYTES = 8 * 1024;
const MAX_EXCERPT_CHARS = 320;

export interface LinkPreviewContent {
  title: string;
  path: string;
  heading: string | null;
  excerpt: string;
  aliases: string[];
  tags: string[];
  metadataTruncated: boolean;
  contentTruncated: boolean;
  headingOutOfRange: boolean;
}

interface RawPreviewMetadata {
  title: string | null;
  aliases: string[];
  tags: string[];
  truncated: boolean;
}

const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });

function truncateCodePoints(value: string, limit: number): [string, boolean] {
  const points = Array.from(value);
  return points.length > limit ? [points.slice(0, limit).join(""), true] : [value, false];
}

function metadataValues(value: unknown): { values: string[]; truncated: boolean } {
  const input =
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
  let truncated = Array.isArray(value) && input.length !== value.length;
  if (input.length > MAX_METADATA_ITEMS) truncated = true;
  const values = input.slice(0, MAX_METADATA_ITEMS).map((item) => {
    const [text, cut] = truncateCodePoints(item, MAX_TEXT_CHARS);
    truncated ||= cut;
    return text;
  });
  return { values, truncated };
}

function boundedMetadata(data: Record<string, unknown> | null): RawPreviewMetadata {
  const titleValue = typeof data?.title === "string" ? data.title : null;
  const [title, titleTruncated] = titleValue
    ? truncateCodePoints(titleValue, MAX_TEXT_CHARS)
    : [null, false];
  const aliases = metadataValues(data?.aliases);
  const tags = metadataValues(data?.tags);
  const encoder = new TextEncoder();
  let remaining = MAX_METADATA_BYTES;
  let truncated = titleTruncated || aliases.truncated || tags.truncated;

  function fit(value: string): string | null {
    const bytes = encoder.encode(value);
    if (bytes.length <= remaining) {
      remaining -= bytes.length;
      return value;
    }
    truncated = true;
    const points = Array.from(value);
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (encoder.encode(points.slice(0, middle).join("")).length <= remaining) low = middle;
      else high = middle - 1;
    }
    if (low === 0) return null;
    const result = points.slice(0, low).join("");
    remaining -= encoder.encode(result).length;
    return result;
  }

  const fittedTitle = title ? fit(title) : null;
  const fitList = (values: string[]) =>
    values.flatMap((value) => {
      const fitted = fit(value);
      return fitted === null ? [] : [fitted];
    });
  return {
    title: fittedTitle,
    aliases: fitList(aliases.values),
    tags: fitList(tags.values),
    truncated,
  };
}

function inlineText(token: Token): string {
  return (token.children ?? [])
    .flatMap((child) => {
      if (child.type === "text") return [child.content];
      if (child.type === "softbreak" || child.type === "hardbreak") return [" "];
      return [];
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAnchor(value: string): string {
  let decoded = value.replace(/^#/, "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // 不正なpercent-encodingはそのまま比較し、例外でプレビュー全体を失敗させない。
  }
  return decoded
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function extractExcerpt(
  content: string,
  anchor: string | null,
  truncated: boolean
): Pick<LinkPreviewContent, "heading" | "excerpt" | "headingOutOfRange"> {
  const withoutHtml = content
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ");
  const tokens = parser.parse(withoutHtml, {});
  const wanted = anchor ? normalizeAnchor(anchor) : null;
  let heading: string | null = null;
  let collect = !wanted;
  const parts: string[] = [];
  const headingCounts = new Map<string, number>();

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "heading_open") {
      const headingText = tokens[index + 1]?.type === "inline" ? inlineText(tokens[index + 1]) : "";
      const baseSlug = normalizeAnchor(headingText);
      const occurrence = headingCounts.get(baseSlug) ?? 0;
      headingCounts.set(baseSlug, occurrence + 1);
      const slug = occurrence === 0 ? baseSlug : `${baseSlug}-${occurrence}`;
      if (wanted && slug === wanted) {
        heading = headingText;
        collect = true;
      } else if (heading && collect) {
        break;
      }
      if (tokens[index + 1]?.type === "inline") index++;
      continue;
    }
    if (!collect || token.type !== "inline") continue;
    const text = inlineText(token);
    if (text) parts.push(text);
    if (Array.from(parts.join(" ")).length > MAX_EXCERPT_CHARS) break;
  }

  const normalized = parts.join(" ").replace(/\s+/g, " ").trim();
  const [excerpt] = truncateCodePoints(normalized, MAX_EXCERPT_CHARS);
  return {
    heading,
    excerpt,
    headingOutOfRange: !!wanted && !heading && truncated,
  };
}

export function extractLinkPreview(
  rawPrefix: string,
  path: string,
  anchor: string | null,
  contentTruncated: boolean
): LinkPreviewContent {
  const frontmatter = extractFrontmatter(rawPrefix);
  const metadata = boundedMetadata(frontmatter.data);
  const excerpt = extractExcerpt(frontmatter.content, anchor, contentTruncated);
  return {
    title: metadata.title || basename(path) || path,
    path,
    ...excerpt,
    aliases: metadata.aliases,
    tags: metadata.tags,
    metadataTruncated: metadata.truncated,
    contentTruncated,
  };
}
