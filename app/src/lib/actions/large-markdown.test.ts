import { describe, expect, it, vi } from "vitest";
import { LargeMarkdownApprovalSession, type MarkdownFileContent } from "./large-markdown";

const small: MarkdownFileContent = {
  raw: "small",
  byteSize: 1024,
  requiresConfirmation: false,
  safeOutline: [],
  safeOutlineTruncated: false,
};
const large: MarkdownFileContent = {
  raw: "large",
  byteSize: 5 * 1024 * 1024,
  requiresConfirmation: true,
  safeOutline: [{ level: 1, text: "Heading", id: "safe-heading-0", utf16Offset: 0 }],
  safeOutlineTruncated: false,
};

describe("LargeMarkdownApprovalSession", () => {
  it("小容量ファイルは確認しない", async () => {
    const confirm = vi.fn(async () => false);
    expect(await new LargeMarkdownApprovalSession().load("small.md", small, {}, confirm)).toEqual({
      raw: "small",
      byteSize: 1024,
      renderMode: "full",
      safeOutline: [],
      safeOutlineTruncated: false,
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("拒否時は本文を返さない", async () => {
    const confirm = vi.fn(async () => false);
    expect(
      await new LargeMarkdownApprovalSession().load("large.md", large, {}, confirm)
    ).toBeUndefined();
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("大容量ファイルはセーフモードで返す", async () => {
    const session = new LargeMarkdownApprovalSession();
    const confirm = vi.fn(async () => true);
    expect(await session.load("large.md", large, {}, confirm)).toMatchObject({
      raw: "large",
      renderMode: "safe",
    });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("watcherで大容量になった未承認ファイルは確認なしでセーフモードへ切り替える", async () => {
    const session = new LargeMarkdownApprovalSession();
    const confirm = vi.fn(async () => false);
    expect(
      await session.load("large.md", large, { currentMode: "full", reason: "watch" }, confirm)
    ).toMatchObject({ renderMode: "safe" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("セーフモード中は小容量になってもセーフモードを維持する", async () => {
    const confirm = vi.fn(async () => false);
    expect(
      await new LargeMarkdownApprovalSession().load(
        "small.md",
        small,
        { currentMode: "safe", reason: "watch" },
        confirm
      )
    ).toMatchObject({ renderMode: "safe" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("通常表示を承認した同一パスは以後fullで返す", async () => {
    const session = new LargeMarkdownApprovalSession();
    const confirmFull = vi.fn(async () => true);
    expect(await session.approveFull("large.md", confirmFull)).toBe(true);
    expect(await session.load("large.md", large, {}, vi.fn())).toMatchObject({
      renderMode: "full",
    });
    expect(await session.approveFull("large.md", confirmFull)).toBe(true);
    expect(confirmFull).toHaveBeenCalledOnce();
  });

  it("同一パスの並行確認を一つにまとめる", async () => {
    const session = new LargeMarkdownApprovalSession();
    let resolveConfirm!: (value: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>((resolve) => (resolveConfirm = resolve)));
    const first = session.load("large.md", large, {}, confirm);
    const second = session.load("large.md", large, {}, confirm);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    resolveConfirm(true);
    expect((await first)?.renderMode).toBe("safe");
    expect((await second)?.renderMode).toBe("safe");
  });

  it("確認ダイアログの失敗はfail-closedにする", async () => {
    const confirm = vi.fn(async () => {
      throw new Error("dialog failed");
    });
    expect(
      await new LargeMarkdownApprovalSession().load("large.md", large, {}, confirm)
    ).toBeUndefined();
  });
});
