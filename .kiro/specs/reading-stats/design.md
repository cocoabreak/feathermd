# 技術設計: 文字数・読了時間の表示 (reading-stats)

## ステータス

完了

---

## 1. 概要

`buildToc`と同じ「レンダリング後の`contentEl`を読み取るだけの純粋な計算」として実装する。DOM複製はせず、`textContent`の文字数・CJK文字数を全体とコードブロック部分それぞれで数え、差し引きすることでコードブロックを除いた概算値を得る。

```
contentEl に {@html renderedHtml} 反映
  → 既存の後処理effect内で computeReadingStats(contentEl) を呼ぶ
    → 結果を readingStatsStore にセット
      → StatusBar.svelte が表示
```

---

## 2. 未決定事項の確定

- **CJK比率のしきい値**: コードブロック・Mermaid図を除いた本文中、空白を除く文字のうちCJK文字（ひらがな・カタカナ・CJK統合漢字）が **30%以上** を占める場合は文字数ベース、それ未満は単語数ベースとする
- **除外対象**: コードブロック（`pre`）に加えて、Mermaidダイアグラム（`svg`、ラベル文字が本文としてカウントされてしまうため）も除外する
- **表示フォーマット**: `1,234字 · 約3分`（CJKベース） / `532 words · 約3分`（単語ベース）
- **表示位置**: ステータスバー右側、ズーム%表示の左隣

---

## 3. `src/lib/markdown/reading-stats.ts`（新規）

```typescript
export interface ReadingStats {
  charCount: number; // 空白を除いた本文文字数（コードブロック/Mermaid除外後）
  wordCount: number | null; // 単語ベース判定時のみ算出
  isCjk: boolean;
  minutes: number;
}

const CJK_RATIO_THRESHOLD = 0.3;
const JP_CHARS_PER_MINUTE = 500;
const EN_WORDS_PER_MINUTE = 200;
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/g;
const EXCLUDE_SELECTOR = "pre, svg";

function countCjk(text: string): number {
  return (text.match(CJK_PATTERN) ?? []).length;
}

function countNonWhitespace(text: string): number {
  return text.replace(/\s/g, "").length;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * container内の本文（コードブロック・Mermaid図を除く）から文字数/単語数・
 * 推定読了時間を概算する。DOM複製はせず、全体とコードブロック等の
 * textContentの数値差分で計算するため軽量。
 */
export function computeReadingStats(container: HTMLElement): ReadingStats | null {
  const allText = container.textContent ?? "";
  const excludedText = Array.from(container.querySelectorAll(EXCLUDE_SELECTOR))
    .map((el) => el.textContent ?? "")
    .join("");

  const proseNonWs = Math.max(0, countNonWhitespace(allText) - countNonWhitespace(excludedText));
  if (proseNonWs === 0) return null;

  const proseCjk = Math.max(0, countCjk(allText) - countCjk(excludedText));
  const isCjk = proseCjk / proseNonWs >= CJK_RATIO_THRESHOLD;

  if (isCjk) {
    return {
      charCount: proseNonWs,
      wordCount: null,
      isCjk,
      minutes: Math.max(1, Math.ceil(proseNonWs / JP_CHARS_PER_MINUTE)),
    };
  }

  const proseWords = Math.max(0, countWords(allText) - countWords(excludedText));
  return {
    charCount: proseNonWs,
    wordCount: proseWords,
    isCjk,
    minutes: Math.max(1, Math.ceil(proseWords / EN_WORDS_PER_MINUTE)),
  };
}
```

- 単語数の差分（`countWords(allText) - countWords(excludedText)`）は境界部分で厳密には±数語ずれ得るが、目安表示のため許容する
- `proseNonWs === 0`（本文が空、コード/図のみ等）の場合は`null`を返し非表示にする

---

## 4. `src/lib/stores/reading-stats.svelte.ts`（新規）

```typescript
import type { ReadingStats } from "$lib/markdown/reading-stats";

function createReadingStatsStore() {
  let stats = $state<ReadingStats | null>(null);

  return {
    get stats() {
      return stats;
    },
    set(value: ReadingStats | null) {
      stats = value;
    },
  };
}

export const readingStatsStore = createReadingStatsStore();
```

---

## 5. `MarkdownViewer.svelte` の変更

既存の後処理`$effect`（`buildToc`呼び出し箇所）に追記する。

```diff
+import { computeReadingStats } from "$lib/markdown/reading-stats";
+import { readingStatsStore } from "$lib/stores/reading-stats.svelte";
...
     if (!raw) {
       renderedHtml = "";
       tocStore.setHeadings([]);
+      readingStatsStore.set(null);
       return;
     }
...
     if (loading || !html) {
-      if (!html) tocStore.setHeadings([]);
+      if (!html) {
+        tocStore.setHeadings([]);
+        readingStatsStore.set(null);
+      }
       return;
     }
...
     const headings = buildToc(contentEl);
     tocStore.setHeadings(headings);
+    readingStatsStore.set(computeReadingStats(contentEl));
```

---

## 6. `StatusBar.svelte` の変更

```diff
+import { readingStatsStore } from "$lib/stores/reading-stats.svelte";
...
+  const readingLabel = $derived.by(() => {
+    const stats = readingStatsStore.stats;
+    if (!stats) return null;
+    const countLabel = stats.isCjk
+      ? `${stats.charCount.toLocaleString()}字`
+      : `${stats.wordCount} words`;
+    return `${countLabel} · 約${stats.minutes}分`;
+  });
...
   <div class="flex-1"></div>

+  {#if readingLabel}
+    <span class="mr-3" title="推定読了時間（目安）">{readingLabel}</span>
+  {/if}
+
   <button onclick={resetZoom} ...>
```

---

## 7. データフロー

```
renderedHtml がcontentElに反映される（既存$effect）
  → buildToc(contentEl) → tocStore.setHeadings(headings)
  → computeReadingStats(contentEl) → readingStatsStore.set(stats)
    → StatusBar.svelteが再描画され「1,234字 · 約3分」等を表示
```

---

## 8. 残課題

なし。設計フェーズ完了。ユーザーごとの読書速度カスタマイズ・厳密な言語判定はスコープ外。
