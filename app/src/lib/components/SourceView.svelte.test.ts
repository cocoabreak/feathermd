import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "$lib/i18n/index.svelte";
import SourceView from "./SourceView.svelte";

describe("SourceView", () => {
  beforeEach(() => i18n.setLocale("ja"));

  it("Markdown内のHTMLを要素化せず原文として表示し、安全な見出しアンカーを置く", () => {
    const raw = '<img src=x onerror="alert(1)">\n# 見出し';
    const { container } = render(SourceView, {
      raw,
      headings: [
        {
          level: 1,
          text: "見出し",
          id: "safe-heading-0",
          utf16Offset: raw.indexOf("# 見出し"),
        },
      ],
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe(raw);
    expect(container.querySelector("#safe-heading-0")).toBeInTheDocument();
  });

  it("全文をクリップボードへコピーする", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(SourceView, { raw: "# source", headings: [] });

    await fireEvent.click(screen.getByRole("button", { name: "Markdownをコピー" }));

    expect(writeText).toHaveBeenCalledWith("# source");
    expect(screen.getByRole("button", { name: "コピーしました" })).toBeInTheDocument();
  });
});
