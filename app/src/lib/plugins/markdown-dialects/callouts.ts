import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

export const MAX_CALLOUT_DEPTH = 4;
export const MAX_CALLOUTS_PER_DOCUMENT = 256;
export const MAX_CALLOUT_TITLE_LENGTH = 256;

type CanonicalCalloutType =
  | "note"
  | "abstract"
  | "info"
  | "todo"
  | "tip"
  | "important"
  | "success"
  | "question"
  | "warning"
  | "caution"
  | "failure"
  | "danger"
  | "bug"
  | "example"
  | "quote";

type CalloutIcon =
  "info" | "todo" | "tip" | "success" | "question" | "warning" | "bug" | "example" | "quote";
type FoldState = "none" | "open" | "closed";

interface CalloutDefinition {
  title: string;
  icon: CalloutIcon;
}

interface CalloutMeta {
  type: CanonicalCalloutType;
  title: string;
  fold: FoldState;
}

const CALLOUT_DEFINITIONS: Record<CanonicalCalloutType, CalloutDefinition> = {
  note: { title: "Note", icon: "info" },
  abstract: { title: "Abstract", icon: "info" },
  info: { title: "Info", icon: "info" },
  todo: { title: "Todo", icon: "todo" },
  tip: { title: "Tip", icon: "tip" },
  important: { title: "Important", icon: "warning" },
  success: { title: "Success", icon: "success" },
  question: { title: "Question", icon: "question" },
  warning: { title: "Warning", icon: "warning" },
  caution: { title: "Caution", icon: "warning" },
  failure: { title: "Failure", icon: "warning" },
  danger: { title: "Danger", icon: "warning" },
  bug: { title: "Bug", icon: "bug" },
  example: { title: "Example", icon: "example" },
  quote: { title: "Quote", icon: "quote" },
};

const CALLOUT_ALIASES: Record<string, CanonicalCalloutType> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

const CALLOUT_MARKER = /^\[!([A-Za-z][A-Za-z0-9_-]{0,31})\]([+-]?)[ \t]*([^\r\n]*)(?:\r?\n|$)/;

const ICONS: Record<CalloutIcon, string> = {
  info: '<svg viewBox="0 0 24 24" role="img" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path></svg>',
  todo: '<svg viewBox="0 0 24 24" role="img" focusable="false"><rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="m8 12 2.5 2.5L16 9"></path></svg>',
  tip: '<svg viewBox="0 0 24 24" role="img" focusable="false"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M8.5 14.5A7 7 0 1 1 15.5 14.5C14.5 15.3 14 16.2 14 18h-4c0-1.8-.5-2.7-1.5-3.5Z"></path></svg>',
  success:
    '<svg viewBox="0 0 24 24" role="img" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16.5 9"></path></svg>',
  question:
    '<svg viewBox="0 0 24 24" role="img" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M9.8 9a2.4 2.4 0 0 1 4.6 1c0 1.8-2.4 2-2.4 4"></path><path d="M12 17h.01"></path></svg>',
  warning:
    '<svg viewBox="0 0 24 24" role="img" focusable="false"><path d="M10.3 4.3 2.7 18a2 2 0 0 0 1.8 3h15a2 2 0 0 0 1.8-3L13.7 4.3a2 2 0 0 0-3.4 0Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>',
  bug: '<svg viewBox="0 0 24 24" role="img" focusable="false"><path d="M8 2l1.5 2.5"></path><path d="M16 2l-1.5 2.5"></path><rect x="6" y="5" width="12" height="15" rx="6"></rect><path d="M3 10h4"></path><path d="M17 10h4"></path><path d="M3 16h4"></path><path d="M17 16h4"></path><path d="M12 5v15"></path></svg>',
  example:
    '<svg viewBox="0 0 24 24" role="img" focusable="false"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"></path><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"></path><path d="M10 8h4"></path><path d="M10 12h4"></path><path d="M10 16h4"></path></svg>',
  quote:
    '<svg viewBox="0 0 24 24" role="img" focusable="false"><path d="M9 11H5a4 4 0 0 1 4-4v8a4 4 0 0 1-4 4"></path><path d="M19 11h-4a4 4 0 0 1 4-4v8a4 4 0 0 1-4 4"></path></svg>',
};

function canonicalType(marker: string): CanonicalCalloutType | null {
  const normalized = marker.toLowerCase();
  if (normalized in CALLOUT_DEFINITIONS) return normalized as CanonicalCalloutType;
  return CALLOUT_ALIASES[normalized] ?? null;
}

function firstParagraph(
  tokens: Token[],
  blockquoteOpenIndex: number
): { open: Token; inline: Token; close: Token } | null {
  const paragraphOpen = tokens[blockquoteOpenIndex + 1];
  const inline = tokens[blockquoteOpenIndex + 2];
  const paragraphClose = tokens[blockquoteOpenIndex + 3];

  if (
    !paragraphOpen ||
    !inline ||
    !paragraphClose ||
    paragraphOpen.type !== "paragraph_open" ||
    inline.type !== "inline" ||
    paragraphClose.type !== "paragraph_close"
  ) {
    return null;
  }

  return { open: paragraphOpen, inline, close: paragraphClose };
}

function foldState(marker: string): FoldState {
  if (marker === "+") return "open";
  if (marker === "-") return "closed";
  return "none";
}

function transformCallouts(tokens: Token[]): void {
  const blockquoteStack: Array<"aside" | "details" | null> = [];
  let transformed = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "blockquote_close") {
      const tag = blockquoteStack.pop();
      if (tag) {
        token.type = "callout_close";
        token.tag = tag;
      }
      continue;
    }
    if (token.type !== "blockquote_open") continue;

    const depth = blockquoteStack.length + 1;
    blockquoteStack.push(null);
    if (depth > MAX_CALLOUT_DEPTH || transformed >= MAX_CALLOUTS_PER_DOCUMENT) continue;

    const paragraph = firstParagraph(tokens, index);
    if (!paragraph) continue;

    const match = paragraph.inline.content.match(CALLOUT_MARKER);
    if (!match) continue;

    const type = canonicalType(match[1]);
    if (!type) continue;

    const customTitle = match[3].trim();
    if ([...customTitle].length > MAX_CALLOUT_TITLE_LENGTH) continue;

    const fold = foldState(match[2]);
    const tag = fold === "none" ? "aside" : "details";
    const meta: CalloutMeta = {
      type,
      title: customTitle || CALLOUT_DEFINITIONS[type].title,
      fold,
    };

    token.type = "callout_open";
    token.tag = tag;
    token.meta = meta;
    token.attrSet("class", `callout callout-${type}`);
    token.attrSet("data-callout", type);
    if (fold === "open") token.attrSet("open", "");
    blockquoteStack[blockquoteStack.length - 1] = tag;

    const remaining = paragraph.inline.content.slice(match[0].length).replace(/^[ \t]*/, "");
    paragraph.inline.content = remaining;
    if (remaining.length === 0) {
      paragraph.open.hidden = true;
      paragraph.close.hidden = true;
    }

    transformed += 1;
  }
}

function renderTitle(md: MarkdownIt, title: string): string {
  try {
    return md.renderInline(title);
  } catch (error) {
    console.warn("callout title render error:", error);
    return md.utils.escapeHtml(title);
  }
}

export function installCallouts(md: MarkdownIt): void {
  md.core.ruler.after("block", "callouts", (state) => {
    transformCallouts(state.tokens);
  });

  md.renderer.rules.callout_open = (tokens, index, _options, _env, renderer) => {
    const token = tokens[index];
    const meta = token.meta as CalloutMeta;
    const definition = CALLOUT_DEFINITIONS[meta.type];
    const titleTag = meta.fold === "none" ? "div" : "summary";
    const icon = ICONS[definition.icon];
    const title = renderTitle(md, meta.title);

    return `<${token.tag}${renderer.renderAttrs(token)}><${titleTag} class="callout-title"><span class="callout-icon" aria-hidden="true">${icon}</span><span class="callout-title-text">${title}</span></${titleTag}>`;
  };

  md.renderer.rules.callout_close = (tokens, index) => `</${tokens[index].tag}>\n`;
}
