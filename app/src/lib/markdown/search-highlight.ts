export interface HighlightResult {
  marks: HTMLElement[];
  error: string | null;
  truncated: boolean;
}

export interface MatchRange {
  index: number;
  length: number;
}

export interface TextSearchResponse {
  matches: MatchRange[][];
  error: string | null;
  truncated: boolean;
}

export const MAX_SEARCH_MATCHES = 500;
const REGEX_TIMEOUT_MS = 500;

/** 既存のハイライトmark要素を取り除きテキストノードに戻す。親ごとに1回だけnormalizeする。 */
export function clearHighlights(container: HTMLElement): void {
  const parents = new Set<Node>();
  container.querySelectorAll("mark.search-match").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parents.add(parent);
  });
  parents.forEach((parent) => parent.normalize());
}

function findLiteralMatches(
  texts: string[],
  query: string,
  maxMatches: number
): TextSearchResponse {
  const needle = query.toLocaleLowerCase();
  const matches: MatchRange[][] = [];
  let total = 0;
  let truncated = false;

  for (const text of texts) {
    const haystack = text.toLocaleLowerCase();
    const found: MatchRange[] = [];
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      if (total >= maxMatches) {
        truncated = true;
        break;
      }
      found.push({ index, length: query.length });
      total++;
      from = index + Math.max(query.length, 1);
    }
    matches.push(found);
    if (truncated) break;
  }
  return { matches, error: null, truncated };
}

function findRegexMatchesSync(
  texts: string[],
  query: string,
  maxMatches: number
): TextSearchResponse {
  try {
    const regex = new RegExp(query, "gi");
    const matches: MatchRange[][] = [];
    let total = 0;
    let truncated = false;
    for (const text of texts) {
      const found: MatchRange[] = [];
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text))) {
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        if (total >= maxMatches) {
          truncated = true;
          break;
        }
        found.push({ index: match.index, length: match[0].length });
        total++;
      }
      matches.push(found);
      if (truncated) break;
    }
    return { matches, error: null, truncated };
  } catch (error) {
    return {
      matches: [],
      error: error instanceof Error ? error.message : "無効な正規表現です",
      truncated: false,
    };
  }
}

function findRegexMatches(
  texts: string[],
  query: string,
  maxMatches: number
): Promise<TextSearchResponse> {
  // jsdom等Workerを持たないテスト環境では、安全な小さいfixtureだけ同期評価する。
  if (typeof Worker === "undefined") {
    return Promise.resolve(findRegexMatchesSync(texts, query, maxMatches));
  }

  return new Promise((resolve) => {
    const worker = new Worker(new URL("./search-regex.worker.ts", import.meta.url), {
      type: "module",
    });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      resolve({
        matches: [],
        error: "正規表現の処理時間が上限を超えました",
        truncated: false,
      });
    }, REGEX_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<TextSearchResponse>) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = () => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve({ matches: [], error: "正規表現の処理に失敗しました", truncated: false });
    };
    worker.postMessage({ texts, query, maxMatches });
  });
}

export function findTextMatches(
  texts: string[],
  query: string,
  useRegex: boolean,
  maxMatches = MAX_SEARCH_MATCHES
): Promise<TextSearchResponse> {
  if (!query) return Promise.resolve({ matches: [], error: null, truncated: false });
  return useRegex
    ? findRegexMatches(texts, query, maxMatches)
    : Promise.resolve(findLiteralMatches(texts, query, maxMatches));
}

/** containerのテキストノードを走査し、queryにマッチする箇所を<mark>でラップする。 */
export async function applyHighlights(
  container: HTMLElement,
  query: string,
  useRegex: boolean,
  isCancelled: () => boolean = () => false
): Promise<HighlightResult> {
  if (!query) return { marks: [], error: null, truncated: false };

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) textNodes.push(node as Text);

  const texts = textNodes.map((textNode) => textNode.textContent ?? "");
  const result = await findTextMatches(texts, query, useRegex);
  if (result.error || isCancelled()) {
    return { marks: [], error: result.error, truncated: result.truncated };
  }

  const marks: HTMLElement[] = [];
  for (let nodeIndex = 0; nodeIndex < result.matches.length; nodeIndex++) {
    const found = result.matches[nodeIndex];
    if (found.length === 0) continue;
    const textNode = textNodes[nodeIndex];
    if (!textNode.parentNode || isCancelled()) break;
    const text = textNode.textContent ?? "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const { index, length } of found) {
      if (index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, index)));
      const mark = document.createElement("mark");
      mark.className = "search-match";
      mark.textContent = text.slice(index, index + length);
      fragment.appendChild(mark);
      marks.push(mark);
      cursor = index + length;
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return { marks, error: null, truncated: result.truncated };
}
