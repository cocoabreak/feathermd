import { describe, expect, it } from "vitest";
import { buildSearchResults } from "./search-results";
import { MAX_SEARCH_MATCHES } from "./search-highlight";

describe("buildSearchResults", () => {
  it("Markdownソースから行番号と前後文を生成する", async () => {
    const result = await buildSearchResults("# Title\nhello target world", "target", false);
    expect(result.items).toEqual([{ line: 2, before: "hello ", match: "target", after: " world" }]);
  });

  it("同じ行の複数一致を個別の結果にする", async () => {
    const result = await buildSearchResults("foo foo", "foo", false);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.line)).toEqual([1, 1]);
  });

  it("上限を超えると500件で打ち切る", async () => {
    const raw = Array.from({ length: MAX_SEARCH_MATCHES + 1 }, () => "match").join("\n");
    const result = await buildSearchResults(raw, "match", false);
    expect(result.items).toHaveLength(MAX_SEARCH_MATCHES);
    expect(result.truncated).toBe(true);
  });
});
