import { load } from "js-yaml";

export interface FrontmatterResult {
  data: Record<string, unknown> | null;
  content: string; // frontmatterブロックを取り除いた残りのMarkdown
}

// ファイル先頭の --- ... --- ブロックのみを対象とする（本文中の水平線とは区別するため
// 文字列の先頭からのみマッチさせる）
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function extractFrontmatter(raw: string): FrontmatterResult {
  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) return { data: null, content: raw };

  try {
    const parsed = load(match[1]);
    // マッピング（オブジェクト）として解析できた場合のみメタデータとして扱う
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, content: raw.slice(match[0].length) };
    }
    return { data: null, content: raw };
  } catch (e) {
    console.warn("frontmatter YAML parse error:", e);
    return { data: null, content: raw };
  }
}
