import { describe, expect, it } from "vitest";
import {
  decodeHeadingAnchor,
  headingBaseId,
  headingInlineCodeText,
  headingReferenceMatches,
  headingSlug,
  uniqueHeadingId,
} from "./heading-anchor";

describe("heading anchor", () => {
  it("Unicode文字を保持し、記号と余分な空白を除去する", () => {
    expect(headingSlug("  日本語の 設定！  ")).toBe("日本語の-設定");
    expect(headingSlug("API / HTTP 2")).toBe("api-http-2");
  });

  it("既知の絵文字ショートコードだけをレンダー後DOM相当に除去する", () => {
    expect(headingSlug("Win :trophy:")).toBe("win");
    expect(headingSlug("Keep :not_a_real_emoji:")).toBe("keep-notarealemoji");
    expect(headingInlineCodeText(":trophy:")).toBe("trophy");
    expect(headingSlug("Win :D")).toBe("win");
    expect(headingSlug("prefix:D")).toBe("prefixd");
    expect(headingInlineCodeText(":D")).toBe("D");
  });

  it("空slugへ決定的なフォールバックを使う", () => {
    expect(headingBaseId("!!!", 3)).toBe("heading-3");
  });

  it("Unicodeコードポイント単位で60文字へ制限する", () => {
    expect(Array.from(headingBaseId("あ".repeat(61), 0))).toHaveLength(60);
    expect(headingBaseId("😀".repeat(61), 0)).toBe("heading-0");
  });

  it("重複IDへ連番を付ける", () => {
    const used = new Set(["details", "details-1"]);
    expect(uniqueHeadingId("details", used)).toBe("details-2");
  });

  it("percent-encodedアンカーを例外なく復号する", () => {
    expect(decodeHeadingAnchor("#%E8%A8%AD%E5%AE%9A")).toBe("設定");
    expect(decodeHeadingAnchor("%broken")).toBe("%broken");
  });

  it("ID・VitePress代替ID・正規化テキストを実遷移と同じ順で照合する", () => {
    expect(headingReferenceMatches("Current", "current", "Current")).toBe(true);
    expect(headingReferenceMatches("My Heading", "my-heading", "My Heading")).toBe(true);
    expect(headingReferenceMatches("123", "_123", "123")).toBe(true);
    expect(headingReferenceMatches("missing", "current", "Current")).toBe(false);
  });
});
