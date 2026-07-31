import type { TocHeading } from "$lib/types";
import {
  decodeHeadingAnchor,
  headingBaseId,
  headingInlineCodeText,
  headingReferenceMatches,
  uniqueHeadingId,
} from "$lib/markdown/heading-anchor";

function headingAnchorText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const footnote of clone.querySelectorAll(".footnote-ref")) {
    footnote.remove();
  }
  for (const katex of clone.querySelectorAll(".katex")) {
    const tex = katex.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? "";
    katex.replaceWith(document.createTextNode(tex));
  }
  for (const code of clone.querySelectorAll("code")) {
    code.textContent = headingInlineCodeText(code.textContent ?? "");
  }
  return clone.textContent?.trim() ?? "";
}

/**
 * レンダリング済みコンテナ内の見出し（h1..h6）にIDを付与し、TOC用のヘディング一覧を返す。
 * GitHub風のslug化を行い、重複IDにはサフィックスを付けて一意にする。
 * 既存IDは尊重し、衝突する場合のみ番号を付ける。
 */
export function buildToc(container: HTMLElement): TocHeading[] {
  const els = container.querySelectorAll("h1,h2,h3,h4,h5,h6");
  const usedIds = new Set<string>();

  return Array.from(els).map((el, i) => {
    const level = parseInt(el.tagName[1]);
    const text = el.textContent?.trim() ?? "";

    if (!el.id) {
      el.id = uniqueHeadingId(headingBaseId(headingAnchorText(el), i), usedIds);
    } else if (usedIds.has(el.id)) {
      el.id = uniqueHeadingId(el.id, usedIds);
    }

    usedIds.add(el.id);
    return { level, text, id: el.id };
  });
}

/**
 * アンカーハッシュから対象要素を探してスクロールする。
 * ID生成アルゴリズムの違い（GitHub / VitePress など）を吸収するためフォールバックを持つ。
 */
export function scrollToAnchor(contentEl: HTMLElement, hash: string): void {
  const decodedHash = decodeHeadingAnchor(hash);
  // 1. 完全一致
  try {
    const el = contentEl.querySelector(`#${CSS.escape(decodedHash)}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      return;
    }
  } catch {
    /* 無効なCSSは無視 */
  }

  // 2. VitePress（数字始まりに_付与）↔ GitHub（_なし）の変換
  const alt = decodedHash.startsWith("_") ? decodedHash.slice(1) : `_${decodedHash}`;
  try {
    const el = contentEl.querySelector(`#${CSS.escape(alt)}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      return;
    }
  } catch {
    /* 無視 */
  }

  // 3. 見出しテキストのノーマライズ比較
  const headings = contentEl.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6");
  for (const h of headings) {
    if (headingReferenceMatches(decodedHash, h.id, headingAnchorText(h))) {
      h.scrollIntoView({ behavior: "smooth" });
      return;
    }
  }
}
