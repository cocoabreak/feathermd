import postcss from "postcss";
import prefixSelector from "postcss-prefix-selector";

const CONTENT_SCOPE = ".markdown-body";

/** ユーザーCSSを検証し、アプリUIへ漏れないようコンテンツ領域へスコープする */
export async function scopeCustomCss(css: string): Promise<string> {
  const rejectUnsupported = {
    postcssPlugin: "reject-unsupported-custom-css",
    AtRule(atRule: { name: string; error: (message: string) => Error }) {
      if (atRule.name.toLowerCase() === "import") {
        throw atRule.error("@import はカスタムCSSで使用できません");
      }
    },
    Declaration(declaration: { value: string; error: (message: string) => Error }) {
      if (/url\s*\(/i.test(declaration.value)) {
        throw declaration.error("url() はカスタムCSSで使用できません");
      }
    },
  };

  const result = await postcss([
    rejectUnsupported,
    prefixSelector({
      prefix: CONTENT_SCOPE,
      transform(prefix, selector, prefixedSelector) {
        const trimmed = selector.trim();
        if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) return selector;
        if (trimmed === ":root" || trimmed === "html" || trimmed === "body") return prefix;
        return prefixedSelector;
      },
    }),
  ]).process(css, { from: undefined });

  return result.css;
}
