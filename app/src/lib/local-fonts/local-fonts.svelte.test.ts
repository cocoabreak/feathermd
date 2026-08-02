import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { settingsStore } from "$lib/stores/settings.svelte";
import {
  applyLocalFonts,
  localFontsRuntimeStore,
  pickLocalFont,
  startLocalFonts,
  type LocalFontStatus,
} from "./local-fonts.svelte";

const invokeMock = vi.mocked(invoke);
const loadedFaces = new Set<FontFace>();

class FakeFontFace {
  family: string;
  source: ArrayBuffer;

  constructor(family: string, source: ArrayBuffer) {
    this.family = family;
    this.source = source;
  }

  async load(): Promise<FontFace> {
    if (new Uint8Array(this.source)[0] === 0xff) throw new Error("invalid font");
    return this as unknown as FontFace;
  }
}

function status(body = true, code = true): LocalFontStatus {
  return {
    body: {
      info: body ? { originalFileName: "body.otf", format: "otf", size: 4 } : null,
      error: null,
    },
    code: {
      info: code ? { originalFileName: "code.ttf", format: "ttf", size: 4 } : null,
      error: null,
    },
  };
}

beforeEach(async () => {
  invokeMock.mockReset();
  loadedFaces.clear();
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      add: (face: FontFace) => loadedFaces.add(face),
      delete: (face: FontFace) => loadedFaces.delete(face),
      ready: Promise.resolve(),
    },
  });
  vi.stubGlobal("FontFace", FakeFontFace);
  settingsStore.setLocalFontsEnabled(false);
  document.getElementById("local-font-style")?.remove();
  const stop = await startLocalFonts().catch(() => () => {});
  stop();
  invokeMock.mockClear();
});

describe("local font runtime", () => {
  it("無効時は状態だけを取得し、バイナリを読み込まない", async () => {
    invokeMock.mockResolvedValueOnce(status());

    await applyLocalFonts();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_local_font_status");
    expect(loadedFaces.size).toBe(0);
    expect(document.getElementById("local-font-style")).toBeNull();
  });

  it("本文とコードだけへ適用し、カスタムCSSより前にstyleを置く", async () => {
    settingsStore.setLocalFontsEnabled(true);
    const customStyle = document.createElement("style");
    customStyle.id = "custom-user-css";
    document.head.append(customStyle);
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_local_font_status") return status();
      const slot = (args as { slot: "body" | "code" }).slot;
      return new Uint8Array([slot === "body" ? 1 : 2, 0, 0, 0]).buffer;
    });

    await applyLocalFonts();

    const style = document.getElementById("local-font-style") as HTMLStyleElement;
    expect(style.textContent).toContain(".markdown-body {");
    expect(style.textContent).toContain(".markdown-body :where(pre, code, kbd, samp)");
    expect(style.textContent).not.toContain("body:not(.markdown-body)");
    expect(style.nextElementSibling).toBe(customStyle);
    expect(loadedFaces.size).toBe(2);
    expect(localFontsRuntimeStore.applied).toEqual({ body: true, code: true });
    customStyle.remove();
  });

  it("片側のFontFace失敗時も正常な側だけを適用する", async () => {
    settingsStore.setLocalFontsEnabled(true);
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_local_font_status") return status();
      const slot = (args as { slot: "body" | "code" }).slot;
      return new Uint8Array([slot === "body" ? 1 : 0xff, 0, 0, 0]).buffer;
    });

    await applyLocalFonts();

    expect(loadedFaces.size).toBe(1);
    expect(localFontsRuntimeStore.applied).toEqual({ body: true, code: false });
    expect(localFontsRuntimeStore.status.code.error).toContain("invalid font");
  });

  it("遅れて完了した旧世代を最新フォントへ上書きしない", async () => {
    settingsStore.setLocalFontsEnabled(true);
    let resolveOld: ((value: ArrayBuffer) => void) | undefined;
    const oldBytes = new Promise<ArrayBuffer>((resolve) => (resolveOld = resolve));
    let statusCalls = 0;
    let reads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_local_font_status") {
        statusCalls += 1;
        return status(true, false);
      }
      reads += 1;
      return reads === 1 ? oldBytes : new Uint8Array([2, 0, 0, 0]).buffer;
    });

    const oldApply = applyLocalFonts();
    await vi.waitFor(() => expect(reads).toBe(1));
    const latestApply = applyLocalFonts();
    await latestApply;
    resolveOld?.(new Uint8Array([1, 0, 0, 0]).buffer);
    await oldApply;

    expect(statusCalls).toBe(2);
    expect(loadedFaces.size).toBe(1);
    const [face] = [...loadedFaces] as unknown as FakeFontFace[];
    expect(new Uint8Array(face.source)[0]).toBe(2);
  });

  it("candidateをブラウザー解析できた場合だけactive slotへcommitする", async () => {
    settingsStore.setLocalFontsEnabled(true);
    invokeMock.mockImplementation(async (command) => {
      if (command === "pick_local_font") {
        return { originalFileName: "body.otf", format: "otf", size: 4 };
      }
      if (command === "read_local_font_candidate") return new Uint8Array([3, 0, 0, 0]).buffer;
      if (command === "get_local_font_status") return status(true, false);
      return undefined;
    });

    await expect(pickLocalFont("body")).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("commit_local_font_candidate", { slot: "body" });
    expect(invokeMock).not.toHaveBeenCalledWith("read_local_font", { slot: "body" });
    expect(invokeMock).not.toHaveBeenCalledWith("discard_local_font_candidate", { slot: "body" });
    expect(loadedFaces.size).toBe(1);
  });

  it("candidateをブラウザー解析できない場合はdiscardして旧slotを維持する", async () => {
    settingsStore.setLocalFontsEnabled(true);
    invokeMock.mockImplementation(async (command) => {
      if (command === "pick_local_font") {
        return { originalFileName: "broken.otf", format: "otf", size: 4 };
      }
      if (command === "read_local_font_candidate") {
        return new Uint8Array([0xff, 0, 0, 0]).buffer;
      }
      return undefined;
    });

    await expect(pickLocalFont("body")).rejects.toThrow("invalid font");

    expect(invokeMock).not.toHaveBeenCalledWith("commit_local_font_candidate", { slot: "body" });
    expect(invokeMock).toHaveBeenCalledWith("discard_local_font_candidate", { slot: "body" });
  });
});
