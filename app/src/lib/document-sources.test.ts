import { describe, expect, it } from "vitest";
import type { DocumentRef, DocumentSourceInfo } from "$lib/types";
import {
  documentKey,
  isSameNativeDocument,
  nativePathToDocument,
  resolveDocumentPath,
  resolveDocumentTarget,
} from "$lib/document-sources";

const nativeSource: DocumentSourceInfo = {
  id: "native-1",
  kind: "native",
  label: "notes",
  nativePath: "C:/notes",
  capabilities: {
    watch: "entries",
    externalEditor: true,
    respectGitignore: true,
    fullTextSearch: true,
    wikiLinks: true,
  },
};

const zipSource: DocumentSourceInfo = {
  ...nativeSource,
  id: "zip-1",
  kind: "zip",
  nativePath: "C:/archives/notes.zip",
  capabilities: {
    ...nativeSource.capabilities,
    watch: "container",
    externalEditor: false,
    respectGitignore: false,
  },
};

describe("document source paths", () => {
  it("source IDを含む衝突しないタブキーを生成する", () => {
    expect(documentKey({ sourceId: "a", path: "guide/read me.md" })).toBe("a:guide%2Fread%20me.md");
    expect(documentKey({ sourceId: "b", path: "guide/read me.md" })).not.toBe(
      documentKey({ sourceId: "a", path: "guide/read me.md" })
    );
  });

  it("相対パスを解決し、ソースルート脱出を拒否する", () => {
    const base: DocumentRef = { sourceId: "zip-1", path: "guide/start.md" };
    expect(resolveDocumentPath(base, "../README.md")).toEqual({
      sourceId: "zip-1",
      path: "README.md",
    });
    expect(resolveDocumentPath(base, "../../secret.md")).toBeNull();
    expect(resolveDocumentPath(base, "C:/secret.md")).toBeNull();
  });

  it("Nativeの絶対パスは同じルート内だけDocumentRefへ変換する", () => {
    const base = { sourceId: "native-1", path: "guide/start.md" };
    expect(resolveDocumentTarget(nativeSource, base, "C:/notes/README.md")).toEqual({
      sourceId: "native-1",
      path: "README.md",
    });
    expect(resolveDocumentTarget(nativeSource, base, "C:/outside/secret.md")).toBeNull();
    expect(nativePathToDocument(nativeSource, "c:/NOTES/guide/start.md")).toEqual(base);
  });

  it("ZIPではOS絶対パスを受け入れない", () => {
    const base = { sourceId: "zip-1", path: "guide/start.md" };
    expect(resolveDocumentTarget(zipSource, base, "C:/notes/README.md")).toBeNull();
  });

  it("異なるNativeソースから参照した同じ実ファイルを同一と判定する", () => {
    const nestedSource = { ...nativeSource, id: "native-2", nativePath: "C:/notes/guide" };
    expect(
      isSameNativeDocument(
        nativeSource,
        { sourceId: nativeSource.id, path: "guide/start.md" },
        nestedSource,
        { sourceId: nestedSource.id, path: "start.md" }
      )
    ).toBe(true);
  });

  it("case-sensitive形式のNativeパスは大文字小文字が異なる別ファイルを統合しない", () => {
    const unixSource = { ...nativeSource, id: "unix", nativePath: "/notes" };
    expect(
      isSameNativeDocument(unixSource, { sourceId: unixSource.id, path: "Note.md" }, unixSource, {
        sourceId: unixSource.id,
        path: "note.md",
      })
    ).toBe(false);
  });
});
