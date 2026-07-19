import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "$lib/i18n/index.svelte";
import SafeModeView from "./SafeModeView.svelte";

describe("SafeModeView", () => {
  beforeEach(() => i18n.setLocale("ja"));

  it("HTML・画像・リンクを生成せずMarkdownソースをテキスト表示する", () => {
    const raw = '<img src="https://example.com/tracker.png"><a href="https://example.com">x</a>';
    const { container } = render(SafeModeView, {
      raw,
      headings: [],
      onRequestFull: vi.fn(),
    });

    expect(screen.getByText(raw)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelectorAll("pre")).toHaveLength(1);
  });

  it("通常表示ボタンからコールバックを呼ぶ", async () => {
    const onRequestFull = vi.fn();
    render(SafeModeView, { raw: "# title", headings: [], onRequestFull });

    await fireEvent.click(screen.getByRole("button", { name: "通常表示に切り替える" }));

    expect(onRequestFull).toHaveBeenCalledOnce();
  });

  it("見出し位置へ目次用アンカーを挿入する", () => {
    const raw = "intro\n# title\nbody";
    const { container } = render(SafeModeView, {
      raw,
      headings: [{ level: 1, text: "title", id: "safe-heading-0", utf16Offset: 6 }],
      onRequestFull: vi.fn(),
    });

    const anchor = container.querySelector("#safe-heading-0");
    expect(anchor).toBeInTheDocument();
    expect(container.querySelector("pre")?.textContent).toBe(raw);
  });
});
