/** ビューアが対象とするMarkdownファイルの拡張子（小文字・ドットなし）。
 * Rust側 commands::MARKDOWN_EXTENSIONS と対になる単一の定義元。 */
export const MARKDOWN_EXTENSIONS = ["md", "markdown"] as const;

/** パスの拡張子がMarkdown対象かを大文字小文字を無視して判定する */
export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}
