import { describe, expect, it } from "vitest";
import { highlightSegments, rankPickerItems, type PickerItem } from "./picker-match";

const items: PickerItem[] = [
  { id: "guide", label: "Guide.md", detail: "docs/Guide.md" },
  { id: "api", label: "API Reference.md", detail: "reference/API Reference.md" },
  { id: "nested", label: "Notes.md", detail: "deep/project/Notes.md" },
];

describe("rankPickerItems", () => {
  it("prioritizes exact, prefix, substring, then fuzzy matches", () => {
    const candidates: PickerItem[] = [
      { id: "fuzzy", label: "Giant User Interface Document" },
      { id: "substring", label: "My Guide.md" },
      { id: "prefix", label: "Guidebook.md" },
      { id: "exact", label: "guide" },
    ];

    expect(rankPickerItems(candidates, "guide").map((match) => match.item.id)).toEqual([
      "exact",
      "prefix",
      "substring",
      "fuzzy",
    ]);
  });

  it("matches relative paths and command ids through secondary fields", () => {
    expect(rankPickerItems(items, "project").map((match) => match.item.id)).toEqual(["nested"]);
    expect(
      rankPickerItems(
        [{ id: "open", label: "ファイルを開く", keywords: ["file.open"] }],
        "file"
      ).map((match) => match.item.id)
    ).toEqual(["open"]);
  });

  it("limits the displayed candidates", () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      id: String(index),
      label: `File ${index}`,
    }));
    expect(rankPickerItems(many, "", 100)).toHaveLength(100);
  });
});

describe("highlightSegments", () => {
  it("keeps matched characters as safe text segments", () => {
    expect(highlightSegments("Guide.md", [0, 2, 4])).toEqual([
      { text: "G", matched: true },
      { text: "u", matched: false },
      { text: "i", matched: true },
      { text: "d", matched: false },
      { text: "e", matched: true },
      { text: ".md", matched: false },
    ]);
  });
});
