import { describe, expect, it } from "vitest";
import { referenceMenuEntries } from "./reference-menu";

describe("reference menu entries", () => {
  it("文書上では文書形式だけを表示する", () => {
    expect(referenceMenuEntries(false).map((entry) => entry.format)).toEqual([
      "wiki",
      "markdown",
      "path",
    ]);
  });

  it("見出し上では見出し形式も表示する", () => {
    expect(referenceMenuEntries(true).map((entry) => entry.format)).toEqual([
      "wiki",
      "markdown",
      "path",
      "heading-wiki",
      "heading-markdown",
      "heading-name",
    ]);
  });
});
