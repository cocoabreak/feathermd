import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRef, DocumentSourceInfo } from "$lib/types";
import { hydrateLocalImages } from "./local-images";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
const documentRef: DocumentRef = { sourceId: "source-1", path: "readme.md" };
const source: DocumentSourceInfo = {
  id: "source-1",
  kind: "native",
  label: "notes",
  nativePath: "D:/notes",
  capabilities: {
    watch: "entries",
    externalEditor: true,
    respectGitignore: true,
    fullTextSearch: true,
    wikiLinks: true,
  },
};

describe("hydrateLocalImages", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("同じパスを一度だけ読み、複数imgへ共有する", async () => {
    invokeMock.mockImplementation(async (_command: string, args: { document: DocumentRef }) => {
      return `data:image/png;base64,${args.document.path}`;
    });
    const container = document.createElement("div");
    container.innerHTML = '<img src="./same.png"><img src="./same.png"><img src="./other.png">';

    hydrateLocalImages(container, documentRef, source);

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources[0]).toBe(sources[1]);
    expect(sources[2]).not.toBe(sources[0]);
  });

  it("同時読込を4件までに制限する", async () => {
    const resolvers: (() => void)[] = [];
    invokeMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => resolvers.push(() => resolve("data:image/png;base64,x")))
    );
    const container = document.createElement("div");
    container.innerHTML = Array.from(
      { length: 10 },
      (_, index) => `<img src="./${index}.png">`
    ).join("");

    const cancel = hydrateLocalImages(container, documentRef, source);
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(4));
    resolvers.shift()?.();
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(5));
    cancel();
    resolvers.forEach((resolve) => resolve());
  });

  it("キャンセル後に完了した結果をDOMへ反映しない", async () => {
    let resolveRead: ((value: string) => void) | undefined;
    invokeMock.mockImplementation(() => new Promise<string>((resolve) => (resolveRead = resolve)));
    const container = document.createElement("div");
    container.innerHTML = '<img src="./image.png">';

    const cancel = hydrateLocalImages(container, documentRef, source);
    cancel();
    resolveRead?.("data:image/png;base64,x");
    await Promise.resolve();

    expect(container.querySelector("img")?.hasAttribute("src")).toBe(false);
  });

  it("文書単位のdata URL予算を超える画像をDOMへ保持しない", async () => {
    invokeMock.mockResolvedValue("data:image/png;base64,1234567890");
    const container = document.createElement("div");
    container.innerHTML = '<img src="./one.png"><img src="./two.png"><img src="./three.png">';

    hydrateLocalImages(container, documentRef, source, 40);

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await vi.waitFor(() => {
      const hydrated = [...container.querySelectorAll("img")].filter((img) =>
        img.hasAttribute("src")
      );
      expect(hydrated.length).toBeLessThanOrEqual(1);
    });
  });
});
