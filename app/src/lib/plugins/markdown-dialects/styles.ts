export const CALLOUT_STYLE_ID = "markdown-callouts-style";

export const CALLOUT_STYLES = `.markdown-body .callout {
  --callout-color: 210 90% 54%;
  margin: 1rem 0;
  overflow: hidden;
  color: inherit;
  background-color: hsl(var(--callout-color) / 0.08);
  border: 1px solid hsl(var(--callout-color) / 0.3);
  border-left-width: 4px;
  border-radius: 0.375rem;
}

.dark .markdown-body .callout {
  background-color: hsl(var(--callout-color) / 0.12);
  border-color: hsl(var(--callout-color) / 0.45);
}

.markdown-body .callout-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.625rem 0.875rem;
  color: hsl(var(--callout-color));
  font-weight: 600;
  line-height: 1.4;
}

.markdown-body details.callout > summary.callout-title {
  cursor: pointer;
}

.markdown-body .callout-icon {
  display: inline-flex;
  flex: 0 0 auto;
}

.markdown-body .callout-icon svg {
  width: 1.125rem;
  height: 1.125rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.markdown-body .callout-title-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.markdown-body .callout > :not(.callout-title) {
  margin-right: 0.875rem;
  margin-left: 0.875rem;
}

.markdown-body .callout > :last-child {
  margin-bottom: 0.875rem;
}

.markdown-body .callout .callout {
  margin: 0.75rem 0;
}

.markdown-body .callout-note,
.markdown-body .callout-info,
.markdown-body .callout-todo {
  --callout-color: 210 90% 54%;
}

.markdown-body .callout-abstract {
  --callout-color: 188 78% 42%;
}

.markdown-body .callout-tip,
.markdown-body .callout-success {
  --callout-color: 145 65% 38%;
}

.markdown-body .callout-important,
.markdown-body .callout-example {
  --callout-color: 267 75% 58%;
}

.markdown-body .callout-question {
  --callout-color: 40 92% 44%;
}

.markdown-body .callout-warning,
.markdown-body .callout-caution {
  --callout-color: 27 92% 50%;
}

.markdown-body .callout-failure,
.markdown-body .callout-danger,
.markdown-body .callout-bug {
  --callout-color: 0 72% 54%;
}

.markdown-body .callout-quote {
  --callout-color: 215 14% 48%;
}

@media print {
  .markdown-body .callout {
    break-inside: avoid-page;
    print-color-adjust: exact;
  }

  .markdown-body details.callout:not([open]) > :not(summary) {
    display: block !important;
  }
}`;

export function ensureCalloutStyles(container: HTMLElement): void {
  if (!container.querySelector(".callout") || document.getElementById(CALLOUT_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = CALLOUT_STYLE_ID;
  style.textContent = CALLOUT_STYLES;

  const customCss = document.getElementById("custom-user-css");
  if (customCss) {
    customCss.before(style);
  } else {
    document.head.appendChild(style);
  }
}
