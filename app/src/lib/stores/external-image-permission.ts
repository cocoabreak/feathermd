const approvedDocumentPaths = new Set<string>();

export function approveExternalImagesForDocument(path: string): void {
  if (path) approvedDocumentPaths.add(path);
}

export function areExternalImagesApprovedForDocument(path: string): boolean {
  return path !== "" && approvedDocumentPaths.has(path);
}

/** テスト用。許可は永続化せず、実アプリではプロセス終了時に破棄される。 */
export function clearExternalImageApprovals(): void {
  approvedDocumentPaths.clear();
}
