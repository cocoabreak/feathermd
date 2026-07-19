interface RegexSearchRequest {
  texts: string[];
  query: string;
  maxMatches: number;
}

interface RegexSearchResponse {
  matches: { index: number; length: number }[][];
  error: string | null;
  truncated: boolean;
}

self.onmessage = (event: MessageEvent<RegexSearchRequest>) => {
  const { texts, query, maxMatches } = event.data;
  const response: RegexSearchResponse = { matches: [], error: null, truncated: false };
  try {
    const regex = new RegExp(query, "gi");
    let total = 0;
    for (const text of texts) {
      const found: { index: number; length: number }[] = [];
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text))) {
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        if (total >= maxMatches) {
          response.truncated = true;
          break;
        }
        found.push({ index: match.index, length: match[0].length });
        total++;
      }
      response.matches.push(found);
      if (response.truncated) break;
    }
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  postMessage(response);
};
