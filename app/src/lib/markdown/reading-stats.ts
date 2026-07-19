export interface ReadingStats {
  charCount: number; // 空白を除いた本文文字数（コードブロック/Mermaid除外後）
  wordCount: number | null; // 単語ベース判定時のみ算出
  isCjk: boolean;
  minutes: number;
}

const CJK_RATIO_THRESHOLD = 0.3;
const JP_CHARS_PER_MINUTE = 500;
const EN_WORDS_PER_MINUTE = 200;
// ひらがな・カタカナ、CJK統合漢字拡張A、CJK統合漢字、半角カタカナ
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/g;
// 本文の「読む」対象から除外する（コードブロック・Mermaid図のラベル文字）
const EXCLUDE_SELECTOR = "pre, svg";

function countCjk(text: string): number {
  return (text.match(CJK_PATTERN) ?? []).length;
}

function countNonWhitespace(text: string): number {
  return text.replace(/\s/g, "").length;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * container内の本文（コードブロック・Mermaid図を除く）から文字数/単語数・
 * 推定読了時間を概算する。DOM複製はせず、全体とコードブロック等の
 * textContentの数値差分で計算するため軽量。
 */
export function computeReadingStats(container: HTMLElement): ReadingStats | null {
  const allText = container.textContent ?? "";
  const excludedText = Array.from(container.querySelectorAll(EXCLUDE_SELECTOR))
    .map((el) => el.textContent ?? "")
    .join("");

  const proseNonWs = Math.max(0, countNonWhitespace(allText) - countNonWhitespace(excludedText));
  if (proseNonWs === 0) return null;

  const proseCjk = Math.max(0, countCjk(allText) - countCjk(excludedText));
  const isCjk = proseCjk / proseNonWs >= CJK_RATIO_THRESHOLD;

  if (isCjk) {
    return {
      charCount: proseNonWs,
      wordCount: null,
      isCjk,
      minutes: Math.max(1, Math.ceil(proseNonWs / JP_CHARS_PER_MINUTE)),
    };
  }

  const proseWords = Math.max(0, countWords(allText) - countWords(excludedText));
  return {
    charCount: proseNonWs,
    wordCount: proseWords,
    isCjk,
    minutes: Math.max(1, Math.ceil(proseWords / EN_WORDS_PER_MINUTE)),
  };
}
