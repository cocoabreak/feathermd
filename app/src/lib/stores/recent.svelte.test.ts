import { describe, it, expect, beforeEach } from "vitest";
import { recentStore } from "./recent.svelte";

describe("recentStore", () => {
  beforeEach(() => {
    recentStore.setAll({ files: [], folders: [] });
  });

  it("addFile はファイルを先頭に追加する", () => {
    recentStore.addFile("/a.md");
    recentStore.addFile("/b.md");

    expect(recentStore.files.map((f) => f.path)).toEqual(["/b.md", "/a.md"]);
  });

  it("addFile は同じパスを追加すると重複させず先頭に移動する", () => {
    recentStore.addFile("/a.md");
    recentStore.addFile("/b.md");
    recentStore.addFile("/a.md");

    expect(recentStore.files.map((f) => f.path)).toEqual(["/a.md", "/b.md"]);
  });

  it("addFile は最大10件を超えると古いものから切り捨てる", () => {
    for (let i = 0; i < 12; i++) {
      recentStore.addFile(`/${i}.md`);
    }

    expect(recentStore.files).toHaveLength(10);
    expect(recentStore.files[0].path).toBe("/11.md");
    expect(recentStore.files.at(-1)?.path).toBe("/2.md");
  });

  it("addFolder はfilesとは独立したリストで管理される", () => {
    recentStore.addFile("/a.md");
    recentStore.addFolder("/proj");

    expect(recentStore.files.map((f) => f.path)).toEqual(["/a.md"]);
    expect(recentStore.folders.map((f) => f.path)).toEqual(["/proj"]);
  });

  it("addArchive はfiles・foldersとは独立したリストで管理される", () => {
    recentStore.addArchive("C:/docs/notes.zip");
    recentStore.addFolder("C:/docs");

    expect(recentStore.archives.map((entry) => entry.path)).toEqual(["C:/docs/notes.zip"]);
    recentStore.removeArchive("C:/docs/notes.zip");
    expect(recentStore.archives).toEqual([]);
    expect(recentStore.folders).toHaveLength(1);
  });

  it("titleはパス末尾のファイル/フォルダー名になる", () => {
    recentStore.addFile("C:/Users/foo/bar.md");
    expect(recentStore.files[0].title).toBe("bar.md");
  });

  it("setAll は保存済みの内容で置き換える", () => {
    recentStore.addFile("/a.md");
    recentStore.setAll({
      files: [{ path: "/x.md", title: "x.md" }],
      folders: [{ path: "/y", title: "y" }],
    });

    expect(recentStore.files.map((f) => f.path)).toEqual(["/x.md"]);
    expect(recentStore.folders.map((f) => f.path)).toEqual(["/y"]);
  });

  it("removeFile は指定したファイルだけを削除する", () => {
    recentStore.addFile("/a.md");
    recentStore.addFile("/b.md");
    recentStore.removeFile("/a.md");
    expect(recentStore.files.map((f) => f.path)).toEqual(["/b.md"]);
  });

  it("removeFolder は指定したフォルダーだけを削除する", () => {
    recentStore.addFolder("/a");
    recentStore.addFolder("/b");
    recentStore.removeFolder("/b");
    expect(recentStore.folders.map((f) => f.path)).toEqual(["/a"]);
  });
});
