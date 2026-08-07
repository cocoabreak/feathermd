import { beforeEach, describe, expect, it } from "vitest";
import { CALLOUT_STYLE_ID, CALLOUT_STYLES, ensureCalloutStyles } from "./styles";

beforeEach(() => {
  document.getElementById(CALLOUT_STYLE_ID)?.remove();
  document.getElementById("custom-user-css")?.remove();
});

describe("Callout styles", () => {
  it("Calloutがある場合だけ固定styleを1回挿入する", () => {
    const empty = document.createElement("div");
    ensureCalloutStyles(empty);
    expect(document.getElementById(CALLOUT_STYLE_ID)).toBeNull();

    const container = document.createElement("div");
    container.innerHTML = '<aside class="callout"></aside>';
    ensureCalloutStyles(container);
    ensureCalloutStyles(container);

    const styles = document.querySelectorAll(`#${CALLOUT_STYLE_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(CALLOUT_STYLES);
  });

  it("カスタムCSSより前へ挿入してユーザー指定を後勝ちにする", () => {
    const customCss = document.createElement("style");
    customCss.id = "custom-user-css";
    document.head.appendChild(customCss);
    const container = document.createElement("div");
    container.innerHTML = '<aside class="callout"></aside>';

    ensureCalloutStyles(container);

    const callouts = document.getElementById(CALLOUT_STYLE_ID);
    expect(callouts?.nextElementSibling).toBe(customCss);
  });
});
