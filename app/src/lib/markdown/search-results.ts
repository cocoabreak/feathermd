import { findTextMatches, MAX_SEARCH_MATCHES } from "./search-highlight";

export interface SearchResultItem {
  line: number;
  before: string;
  match: string;
  after: string;
}

export interface SearchResultList {
  items: SearchResultItem[];
  error: string | null;
  truncated: boolean;
}

const CONTEXT_CHARS = 80;

export async function buildSearchResults(
  raw: string,
  query: string,
  useRegex: boolean
): Promise<SearchResultList> {
  if (!query) return { items: [], error: null, truncated: false };
  const lines = raw.split(/\r?\n/);
  const result = await findTextMatches(lines, query, useRegex, MAX_SEARCH_MATCHES);
  if (result.error) return { items: [], error: result.error, truncated: false };

  const items: SearchResultItem[] = [];
  for (let lineIndex = 0; lineIndex < result.matches.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    for (const range of result.matches[lineIndex]) {
      const beforeStart = Math.max(0, range.index - CONTEXT_CHARS);
      const afterEnd = Math.min(line.length, range.index + range.length + CONTEXT_CHARS);
      items.push({
        line: lineIndex + 1,
        before: `${beforeStart > 0 ? "…" : ""}${line.slice(beforeStart, range.index)}`,
        match: line.slice(range.index, range.index + range.length),
        after: `${line.slice(range.index + range.length, afterEnd)}${afterEnd < line.length ? "…" : ""}`,
      });
    }
  }
  return { items, error: null, truncated: result.truncated };
}
