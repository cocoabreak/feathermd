import DOMPurify from "dompurify";

/**
 * markdown-it の `html: true` により素通しされる生HTML（<script> 等）を無害化する。
 * KaTeXは根号などの一部グリフをインラインSVGで出力するため svg プロファイルも必須。
 * class / style / data-* はDOMPurifyの既定許可リストに含まれており、
 * shikiのインラインstyle・mermaidプレースホルダーのdata-code・タスクリストのcheckboxは
 * 追加設定なしでそのまま残る。
 *
 * <form> はDOMPurifyのhtmlプロファイルでは既定で許可されるが、ビューアに正当な用途がなく、
 * 悪意ある.md内のフォームが外部サーバーへPOSTしうるため除去する。KEEP_CONTENT(既定true)により
 * フォーム内の通常コンテンツは残り、危険な action を持つ<form>ラッパーだけが取り除かれる。
 * タスクリストの<input type=checkbox>はフォーム外の要素なので影響しない。
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    // style要素は外部画像URLをCSSエスケープで難読化でき、属性単位の保護を
    // 迂回しうる。Markdown本文で正当な用途もないため禁止する。
    FORBID_TAGS: ["form", "style"],
  });
}
