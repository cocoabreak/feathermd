import type { SafeOutlineHeading } from "$lib/types";

export type SourceSegment = { text: string; heading?: SafeOutlineHeading };

/** UTF-16 offsetで示された安全な見出し位置へ、表示用アンカーを差し込む。 */
export function splitSourceAtHeadings(
  source: string,
  outline: SafeOutlineHeading[]
): SourceSegment[] {
  const segments: SourceSegment[] = [];
  let cursor = 0;
  for (const heading of outline) {
    const offset = Math.max(cursor, Math.min(heading.utf16Offset, source.length));
    if (offset > cursor) segments.push({ text: source.slice(cursor, offset) });
    segments.push({ text: "", heading });
    cursor = offset;
  }
  segments.push({ text: source.slice(cursor) });
  return segments;
}
