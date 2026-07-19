export type ExternalImageProtectionResult = {
  html: string;
  blockedCount: number;
};

function removeAsciiWhitespaceAndControls(value: string): string {
  return [...value].filter((character) => character.charCodeAt(0) > 0x20).join("");
}

function isExternalUrl(value: string | null): boolean {
  if (!value) return false;
  // URL StandardはASCII空白やspecial URLのバックスラッシュも正規化する。
  const compact = removeAsciiWhitespaceAndControls(value);
  return /^https?:/i.test(compact) || /^[\\/]{2}/.test(compact);
}

function containsExternalUrl(value: string | null): boolean {
  if (!value) return false;
  const compact = removeAsciiWhitespaceAndControls(value);
  return /https?:/i.test(compact) || /(^|,)[\\/]{2}/.test(compact);
}

function containsCssResource(value: string | null): boolean {
  return value !== null && (/[\\]/.test(value) || /(?:url|image-set)\s*\(/i.test(value));
}

/**
 * 外部画像の取得に使われる属性をDOM挿入前に退避する。
 * DOMへ挿入してから除去するとWebViewが先に通信を始める可能性があるため、
 * 必ずsanitize済みHTML文字列に対して呼び出す。
 */
export function protectExternalImages(html: string): ExternalImageProtectionResult {
  const template = document.createElement("template");
  template.innerHTML = html;
  const blockedElements = new Set<Element>();

  const protectAttribute = (
    selector: string,
    attribute: string,
    external: (value: string | null) => boolean = isExternalUrl
  ) => {
    for (const element of template.content.querySelectorAll(selector)) {
      const value = element.getAttribute(attribute);
      if (!external(value)) continue;
      element.setAttribute(`data-external-${attribute.replace(":", "-")}`, value!);
      element.removeAttribute(attribute);
      blockedElements.add(element);
    }
  };

  protectAttribute("img[src]", "src");
  protectAttribute('input[type="image"][src]', "src");
  protectAttribute("video[poster]", "poster");
  protectAttribute("img[srcset]", "srcset", containsExternalUrl);
  protectAttribute("source[srcset]", "srcset", containsExternalUrl);
  protectAttribute("svg image[href]", "href");
  protectAttribute("svg image[xlink\\:href]", "xlink:href");
  protectAttribute("svg feImage[href]", "href");
  protectAttribute("svg feImage[xlink\\:href]", "xlink:href");
  protectAttribute("svg use[href]", "href");
  protectAttribute("svg use[xlink\\:href]", "xlink:href");

  // CSSエスケープを完全に解釈せずfail-closedにするため、URL関数を含む
  // style属性はローカル指定も含めて属性全体を退避する。
  protectAttribute("[style]", "style", containsCssResource);
  for (const attribute of ["fill", "stroke", "filter", "clip-path", "mask", "cursor"]) {
    protectAttribute(`svg [${attribute}]`, attribute, containsCssResource);
  }

  return { html: template.innerHTML, blockedCount: blockedElements.size };
}
