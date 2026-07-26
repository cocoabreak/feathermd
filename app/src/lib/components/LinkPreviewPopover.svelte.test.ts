import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import LinkPreviewPopover from "./LinkPreviewPopover.svelte";
import { LinkPreviewStore } from "$lib/stores/link-preview.svelte";

describe("LinkPreviewPopover", () => {
  it("文書由来値をテキストとして表示する", () => {
    const store = new LinkPreviewStore();
    store.status = "ready";
    store.rect = { top: 10, right: 110, bottom: 30, left: 10, width: 100, height: 20 };
    store.content = {
      title: "<img src=x onerror=alert(1)>",
      path: "guide/target.md",
      heading: "Details",
      excerpt: "<script>alert(1)</script>",
      aliases: ["alias"],
      tags: ["tag"],
      metadataTruncated: false,
      contentTruncated: false,
      headingOutOfRange: false,
    };
    const view = render(LinkPreviewPopover, { props: { store } });

    expect(view.getByRole("tooltip")).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(view.getByRole("tooltip")).toHaveTextContent("<script>alert(1)</script>");
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("script")).toBeNull();
  });

  it("リンク切れでは対象パスだけを表示する", () => {
    const store = new LinkPreviewStore();
    store.status = "missing";
    store.path = "missing/document.md";
    store.rect = { top: 10, right: 110, bottom: 30, left: 10, width: 100, height: 20 };
    const view = render(LinkPreviewPopover, { props: { store } });
    expect(view.getByRole("tooltip")).toHaveTextContent("missing/document.md");
  });
});
