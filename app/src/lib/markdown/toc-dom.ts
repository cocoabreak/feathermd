import type { TocHeading } from "$lib/types";

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
      const base =
        text
          .toLowerCase()
          .replace(/[^\w\s-]/g, "") // 非ASCII・記号を除去
          .replace(/\s+/g, "-") // 空白をハイフンに
          .replace(/^-+|-+$/g, "") // 先頭・末尾のハイフンを除去（---live-editor対策）
          .slice(0, 60) || `heading-${i}`;

      // 重複IDにはサフィックスを付与
      let id = base;
      let n = 1;
      while (usedIds.has(id)) {
        id = `${base}-${n++}`;
      }
      el.id = id;
    } else if (usedIds.has(el.id)) {
      // 既存IDも重複チェック
      const base = el.id;
      let n = 1;
      while (usedIds.has(`${base}-${n}`)) n++;
      el.id = `${base}-${n}`;
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
  // 1. 完全一致
  try {
    const el = contentEl.querySelector(`#${CSS.escape(hash)}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      return;
    }
  } catch {
    /* 無効なCSSは無視 */
  }

  // 2. VitePress（数字始まりに_付与）↔ GitHub（_なし）の変換
  const alt = hash.startsWith("_") ? hash.slice(1) : `_${hash}`;
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
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/^_+/, "")
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const target = normalize(hash);
  const headings = contentEl.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6");
  for (const h of headings) {
    if (normalize(h.textContent?.trim() ?? "") === target) {
      h.scrollIntoView({ behavior: "smooth" });
      return;
    }
  }
}
