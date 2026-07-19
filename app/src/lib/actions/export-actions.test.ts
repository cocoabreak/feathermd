import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { MAX_PNG_DIMENSION, saveAsHtml, saveAsSvg, validatePngDimensions } from "./export-actions";

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockResolvedValue(true);
});

describe("native export commands", () => {
  it("HTML内容だけをRustへ渡し、保存先パスをWebViewで扱わない", async () => {
    await saveAsHtml('</title><script>alert("x")</script>', "<h1>safe</h1>");

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("save_text_export", {
      format: "html",
      suggestedName: '</title><script>alert("x")</script>',
      contents: expect.stringContaining(
        "<title>&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</title>"
      ),
    });
  });

  it("SVGをネイティブ保存コマンドへ渡す", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    await saveAsSvg(svg, "diagram");

    expect(mockedInvoke).toHaveBeenCalledWith("save_text_export", {
      format: "svg",
      suggestedName: "diagram",
      contents: expect.stringContaining('xmlns="http://www.w3.org/2000/svg"'),
    });
  });

  it("PNG Canvasの次元と総画素数を生成前に制限する", () => {
    expect(() => validatePngDimensions(1, 1)).not.toThrow();
    expect(() => validatePngDimensions(MAX_PNG_DIMENSION + 1, 1)).toThrow();
    expect(() => validatePngDimensions(5_001, 5_000)).toThrow();
    expect(() => validatePngDimensions(Number.NaN, 10)).toThrow();
  });
});
