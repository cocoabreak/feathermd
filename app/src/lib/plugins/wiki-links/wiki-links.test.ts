import MarkdownIt from "markdown-it";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import wikiLinksPlugin, { getWikiLinkTarget, watchWikiLinkTarget } from "./index";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

// パース（extendMarkdownIt）のテスト。リンク解決（postRender/Rust側）はRustユニットテストと
// 実機確認でカバーする
describe("wiki-linksプラグインのパース", () => {
  let md: MarkdownIt;

  beforeAll(async () => {
    md = new MarkdownIt();
    await wikiLinksPlugin.extendMarkdownIt?.(md);
  });

  it("基本形 [[ページ名]] をhrefなしのアンカーにする", () => {
    const html = md.render("[[Setup]]");
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-wiki-target="Setup"');
    expect(html).toContain(">Setup</a>");
    expect(html).not.toContain("href=");
  });

  it("エイリアス [[ページ名|表示]] は表示テキストで描画する", () => {
    const html = md.render("[[Setup|セットアップ手順]]");
    expect(html).toContain('data-wiki-target="Setup"');
    expect(html).toContain(">セットアップ手順</a>");
  });

  it("アンカー [[ページ名#見出し]] はdata-wiki-hashを持つ", () => {
    const html = md.render("[[Setup#手順]]");
    expect(html).toContain('data-wiki-target="Setup"');
    expect(html).toContain('data-wiki-hash="手順"');
    expect(html).toContain(">Setup#手順</a>");
  });

  it("同一ファイル内アンカー [[#見出し]] は即hrefを持つ", () => {
    const html = md.render("[[#概要]]");
    expect(html).toContain('href="#概要"');
    expect(html).not.toContain("data-wiki-target");
  });

  it("パス付き [[guide/setup]] をターゲットとして保持する", () => {
    const html = md.render("[[guide/setup]]");
    expect(html).toContain('data-wiki-target="guide/setup"');
  });

  it("空・未閉じ・ネスト・改行跨ぎはリンク化しない", () => {
    expect(md.render("[[]]")).not.toContain("wiki-link");
    expect(md.render("[[abc")).not.toContain("wiki-link");
    expect(md.render("[[a[[b]]]]")).not.toContain('data-wiki-target="a[[b"');
    expect(md.render("[[a\nb]]")).not.toContain("wiki-link");
  });

  it("インラインコード・コードブロック内はリンク化しない", () => {
    expect(md.render("`[[Setup]]`")).not.toContain("wiki-link");
    expect(md.render("```\n[[Setup]]\n```")).not.toContain("wiki-link");
  });

  it("表示テキスト・属性値はエスケープされる", () => {
    const html = md.render('[[a"b|<x>]]');
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;x&gt;");
    expect(html).not.toContain("<x>");
  });
});

describe("wiki-linksプラグインの解決状態", () => {
  beforeEach(() => invokeMock.mockReset());

  it("pendingからRust検証済みDocumentRefへ購読通知する", async () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<a class="wiki-link" data-wiki-target="Setup" data-wiki-hash="手順">Setup</a>';
    const anchor = container.querySelector("a")!;
    invokeMock.mockResolvedValue({
      Setup: { sourceId: "source", path: "guide/setup.md" },
    });
    const cleanup = wikiLinksPlugin.postRender?.(container, {
      document: { sourceId: "source", path: "index.md" },
      source: null,
      filePath: "index.md",
      rootPath: null,
      respectGitignore: true,
      locale: "ja",
      externalImagesAllowed: false,
      onExternalImagesBlocked: () => {},
    });
    const states: string[] = [];
    const stop = watchWikiLinkTarget(anchor, (state) => states.push(state.status));

    await vi.waitFor(() => expect(getWikiLinkTarget(anchor)?.status).toBe("resolved"));
    expect(states).toEqual(["pending", "resolved"]);
    expect(anchor.getAttribute("href")).toBe("guide/setup.md#手順");
    stop();
    cleanup?.();
    expect(getWikiLinkTarget(anchor)).toBeNull();
  });

  it("missingを通知しcleanup後の遅延応答は無視する", async () => {
    const context = {
      document: { sourceId: "source", path: "index.md" },
      source: null,
      filePath: "index.md",
      rootPath: null,
      respectGitignore: true,
      locale: "ja" as const,
      externalImagesAllowed: false,
      onExternalImagesBlocked: () => {},
    };
    const missingContainer = document.createElement("div");
    missingContainer.innerHTML = '<a class="wiki-link" data-wiki-target="Missing">Missing</a>';
    const missingAnchor = missingContainer.querySelector("a")!;
    invokeMock.mockResolvedValueOnce({ Missing: null });
    const cleanupMissing = wikiLinksPlugin.postRender?.(missingContainer, context);
    const states: string[] = [];
    watchWikiLinkTarget(missingAnchor, (state) => states.push(state.status));
    await vi.waitFor(() => expect(getWikiLinkTarget(missingAnchor)?.status).toBe("missing"));
    expect(states).toEqual(["pending", "missing"]);
    cleanupMissing?.();

    let resolve!: (value: Record<string, null>) => void;
    invokeMock.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const staleContainer = document.createElement("div");
    staleContainer.innerHTML = '<a class="wiki-link" data-wiki-target="Stale">Stale</a>';
    const staleAnchor = staleContainer.querySelector("a")!;
    const cleanupStale = wikiLinksPlugin.postRender?.(staleContainer, context);
    expect(getWikiLinkTarget(staleAnchor)?.status).toBe("pending");
    cleanupStale?.();
    resolve({ Stale: null });
    await Promise.resolve();
    expect(getWikiLinkTarget(staleAnchor)).toBeNull();
    expect(staleAnchor).not.toHaveClass("wiki-link-missing");
  });
});
