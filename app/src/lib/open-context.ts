import { isWithinDir } from "$lib/actions/security";

/**
 * 表示中ファイルに対して「親フォルダーを開く」案内が必要かを返す。
 * UX表示専用の判定であり、ファイルアクセスの認可には使用しない。
 */
export function isFileOutsideExplorerRoot(
  filePath: string | null | undefined,
  rootPath: string | null
): boolean {
  return !!filePath && (!rootPath || !isWithinDir(filePath, rootPath));
}
