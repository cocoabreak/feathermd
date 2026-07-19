import { invoke } from "@tauri-apps/api/core";
import type MarkdownIt from "markdown-it";
import type { Locale } from "$lib/i18n/index.svelte";
import type { PostRenderContext, ViewerPlugin } from "../types";
import type { DocumentRef } from "$lib/types";

// プラグイン自己完結の実行時文言（コアの辞書には載せない）
const MESSAGES: Record<Locale, { missing: string }> = {
  ja: { missing: "リンク先が見つかりません" },
  en: { missing: "Link target not found" },
};

type InlineRule = Parameters<MarkdownIt["inline"]["ruler"]["before"]>[2];

const LBRACKET = 0x5b; // [

/**
 * `[[ターゲット(#見出し)?(|エイリアス)?]]` をパースするmarkdown-it inlineルール。
 * この時点ではhrefを付与しない（絶対パスhrefはDOMPurifyのURIスキーム検査で剥がれるため、
 * sanitize後のDOMに対してpostRenderが解決結果を書き込む）。
 * 例外として同一ファイル内アンカー `[[#見出し]]` は相対href（#見出し）を即付与する。
 */
const wikiLinkRule: InlineRule = (state, silent) => {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== LBRACKET || src.charCodeAt(pos + 1) !== LBRACKET) {
    return false;
  }

  const end = src.indexOf("]]", pos + 2);
  if (end === -1) return false;

  const inner = src.slice(pos + 2, end);
  // 空・ネスト・改行跨ぎは不成立（通常のテキストとして残す）
  if (!inner.trim() || inner.includes("[[") || inner.includes("]") || inner.includes("\n")) {
    return false;
  }

  const pipeIdx = inner.indexOf("|");
  const rawTarget = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
  const alias = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : "";
  const hashIdx = rawTarget.indexOf("#");
  const target = (hashIdx >= 0 ? rawTarget.slice(0, hashIdx) : rawTarget).trim();
  const hash = hashIdx >= 0 ? rawTarget.slice(hashIdx + 1).trim() : "";
  if (!target && !hash) return false;

  if (!silent) {
    const open = state.push("wiki_link_open", "a", 1);
    open.attrSet("class", "wiki-link");
    if (target) {
      // リンク先の解決はpostRenderが行う
      open.attrSet("data-wiki-target", target);
      if (hash) open.attrSet("data-wiki-hash", hash);
    } else {
      // [[#見出し]] = 同一ファイル内アンカー。既存のアンカースクロール処理がそのまま効く
      open.attrSet("href", `#${hash}`);
    }

    const text = state.push("text", "", 0);
    text.content = alias || (target && hash ? `${target}#${hash}` : target || `#${hash}`);

    state.push("wiki_link_close", "a", -1);
  }

  state.pos = end + 2;
  return true;
};

const STYLE_ID = "wiki-links-style";

/** 未解決リンク用のスタイルを一度だけ注入する（プラグイン自己完結のため） */
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .markdown-body a.wiki-link.wiki-link-missing {
      color: hsl(var(--muted-foreground));
      text-decoration: none;
      cursor: default;
    }
  `;
  document.head.appendChild(style);
}

/** コンテナ内の未解決wikiリンクをRustコマンドで一括解決し、hrefへ書き込む */
async function resolveLinks(
  pending: HTMLAnchorElement[],
  context: PostRenderContext,
  isCancelled: () => boolean
): Promise<void> {
  const targets = [...new Set(pending.map((a) => a.dataset.wikiTarget ?? ""))].filter(Boolean);

  let resolved: Record<string, DocumentRef | null>;
  try {
    if (!context.document) return;
    resolved = await invoke<Record<string, DocumentRef | null>>("resolve_source_wiki_links", {
      document: context.document,
      targets,
      respectGitignore: context.respectGitignore,
    });
  } catch (e) {
    // 解決失敗（信頼範囲外など）は全リンクを未解決扱いにする
    console.warn("wiki-links: リンク解決に失敗:", e);
    resolved = {};
  }
  if (isCancelled()) return;

  for (const a of pending) {
    const document = resolved[a.dataset.wikiTarget ?? ""] ?? null;
    if (document && context.document) {
      const hash = a.dataset.wikiHash;
      const from = context.document.path.split("/").slice(0, -1);
      const to = document.path.split("/");
      let common = 0;
      while (common < from.length && common < to.length && from[common] === to[common]) {
        common++;
      }
      const relative = [
        ...Array.from({ length: from.length - common }, () => ".."),
        ...to.slice(common),
      ].join("/");
      a.setAttribute("href", hash ? `${relative}#${hash}` : relative);
    } else {
      a.classList.add("wiki-link-missing");
      a.title = MESSAGES[context.locale].missing;
    }
  }
}

/** Obsidian互換のWikiリンク（[[ページ名]]）プラグイン */
const wikiLinksPlugin: ViewerPlugin = {
  name: "wiki-links",
  version: "1.0.0",
  displayName: { ja: "Wikiリンク", en: "Wiki Links" },
  description: { ja: "[[ページ名]] 形式のリンク", en: "[[Page name]] style links" },
  defaultEnabled: true,

  extendMarkdownIt(md): void {
    md.inline.ruler.before("link", "wiki_link", wikiLinkRule);
  },

  postRender(container, context): (() => void) | void {
    const pending = [
      ...container.querySelectorAll<HTMLAnchorElement>("a.wiki-link[data-wiki-target]"),
    ];
    if (pending.length === 0 || !context.filePath) return;

    ensureStyles();
    let cancelled = false;
    void resolveLinks(pending, context, () => cancelled);
    return () => {
      cancelled = true;
    };
  },
};

export default wikiLinksPlugin;
