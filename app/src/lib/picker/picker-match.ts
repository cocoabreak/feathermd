export const MAX_PICKER_RESULTS = 100;

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
  keywords?: string[];
  shortcut?: string;
}

export interface PickerMatch {
  item: PickerItem;
  labelMatches: number[];
  score: number;
}

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

interface TextMatch {
  score: number;
  indices: number[];
}

function characters(value: string): string[] {
  return Array.from(value);
}

function lowerCharacters(value: string): string[] {
  return characters(value).map((character) => character.toLocaleLowerCase());
}

function directMatch(value: string, query: string): TextMatch | null {
  const haystack = lowerCharacters(value);
  const needle = lowerCharacters(query);
  if (needle.length === 0) return { score: 0, indices: [] };

  const joinedHaystack = haystack.join("");
  const joinedNeedle = needle.join("");
  const index = joinedHaystack.indexOf(joinedNeedle);
  if (index < 0) return null;

  const exact = joinedHaystack === joinedNeedle;
  const prefix = index === 0;
  return {
    score: exact ? 0 : prefix ? 10 + haystack.length - needle.length : 30 + index,
    indices: Array.from({ length: needle.length }, (_, offset) => index + offset),
  };
}

function fuzzyMatch(value: string, query: string): TextMatch | null {
  const haystack = lowerCharacters(value);
  const needle = lowerCharacters(query);
  if (needle.length === 0) return { score: 0, indices: [] };

  const indices: number[] = [];
  let cursor = 0;
  for (const wanted of needle) {
    while (cursor < haystack.length && haystack[cursor] !== wanted) cursor += 1;
    if (cursor >= haystack.length) return null;
    indices.push(cursor);
    cursor += 1;
  }

  const startPenalty = indices[0] * 2;
  const gapPenalty = indices.reduce(
    (total, index, position) =>
      position === 0 ? total : total + index - indices[position - 1] - 1,
    0
  );
  return {
    score: 100 + startPenalty + gapPenalty * 3 + (haystack.length - needle.length) / 100,
    indices,
  };
}

function matchText(value: string, query: string): TextMatch | null {
  return directMatch(value, query) ?? fuzzyMatch(value, query);
}

export function rankPickerItems(
  items: PickerItem[],
  query: string,
  limit = MAX_PICKER_RESULTS
): PickerMatch[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return items.slice(0, limit).map((item, index) => ({
      item,
      labelMatches: [],
      score: index,
    }));
  }

  const matches = items.flatMap<PickerMatch>((item) => {
    const labelMatch = matchText(item.label, trimmed);
    const candidates: Array<{ match: TextMatch; penalty: number }> = [];
    if (labelMatch) candidates.push({ match: labelMatch, penalty: 0 });
    const detailMatch = item.detail ? matchText(item.detail, trimmed) : null;
    if (detailMatch) candidates.push({ match: detailMatch, penalty: 50 });
    for (const keyword of item.keywords ?? []) {
      const keywordMatch = matchText(keyword, trimmed);
      if (keywordMatch) candidates.push({ match: keywordMatch, penalty: 70 });
    }
    if (candidates.length === 0) return [];

    const best = candidates.reduce((left, right) =>
      left.match.score + left.penalty <= right.match.score + right.penalty ? left : right
    );
    return [
      {
        item,
        labelMatches: labelMatch?.indices ?? [],
        score: best.match.score + best.penalty,
      },
    ];
  });

  return matches
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.item.label.localeCompare(right.item.label) ||
        left.item.id.localeCompare(right.item.id)
    )
    .slice(0, limit);
}

export function highlightSegments(value: string, indices: number[]): HighlightSegment[] {
  const matched = new Set(indices);
  const result: HighlightSegment[] = [];
  for (const [index, character] of characters(value).entries()) {
    const isMatch = matched.has(index);
    const previous = result.at(-1);
    if (previous?.matched === isMatch) previous.text += character;
    else result.push({ text: character, matched: isMatch });
  }
  return result;
}
