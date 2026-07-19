import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { authorizeArchivePath, authorizePath, parentDir, isWithinDir } from "./security";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("path authorization", () => {
  it("通常ファイルはフォルダー認可コマンドを使う", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    await expect(authorizePath("D:/notes/README.md")).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("authorize_path", { path: "D:/notes/README.md" });
  });

  it("ZIPはアーカイブ単体認可コマンドを使う", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    await expect(authorizeArchivePath("D:/archives/notes.zip")).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("authorize_archive_path", {
      path: "D:/archives/notes.zip",
    });
  });
});

describe("parentDir", () => {
  it("ファイルの親ディレクトリを返す", () => {
    expect(parentDir("D:/projects/notes/README.md")).toBe("D:/projects/notes");
  });

  it("バックスラッシュを正規化する", () => {
    expect(parentDir("D:\\projects\\notes\\README.md")).toBe("D:/projects/notes");
  });
});

describe("isWithinDir", () => {
  const dir = "D:/projects/notes";

  it("同一フォルダ直下は true", () => {
    expect(isWithinDir("D:/projects/notes/README.zh-CN.md", dir)).toBe(true);
  });

  it("サブフォルダ配下は true", () => {
    expect(isWithinDir("D:/projects/notes/docs/intro.md", dir)).toBe(true);
  });

  it("dir 自身は true", () => {
    expect(isWithinDir(dir, dir)).toBe(true);
  });

  it("別フォルダ（上位）は false", () => {
    expect(isWithinDir("D:/projects/other/secret.md", dir)).toBe(false);
  });

  it("プレフィックスが一致するだけの兄弟フォルダは false（notesX を notes とみなさない）", () => {
    expect(isWithinDir("D:/projects/notesX/x.md", dir)).toBe(false);
  });

  it("バックスラッシュ・末尾スラッシュを正規化して判定する", () => {
    expect(isWithinDir("D:\\projects\\notes\\README.md", "D:/projects/notes/")).toBe(true);
  });
});
