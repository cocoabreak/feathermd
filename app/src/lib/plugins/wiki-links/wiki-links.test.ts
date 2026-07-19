import MarkdownIt from "markdown-it";
import { beforeAll, describe, expect, it } from "vitest";
import wikiLinksPlugin from "./index";

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
