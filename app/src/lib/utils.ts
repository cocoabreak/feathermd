/** Windowsのバックスラッシュ区切りをスラッシュ区切りに正規化する */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** パスの末尾要素（ファイル名）を返す。区切りが無ければ元の文字列を返す */
export function basename(path: string): string {
  return normalizePath(path).split("/").pop() || path;
}
