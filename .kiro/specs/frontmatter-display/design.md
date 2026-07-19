# 技術設計: frontmatter（YAML）のメタデータ表示 (frontmatter-display)

## ステータス

完了

---

## 1. 概要

`renderMarkdown()`の先頭でYAML frontmatterブロックを検出・解析し、本文（markdown-itに渡す文字列）から取り除く。解析結果は`renderMarkdown()`の戻り値に含めて呼び出し元へ返し、`frontmatterStore`経由でTOCパネル上部に表示する。

```
raw（生Markdown文字列）
  → extractFrontmatter(raw)
    → { data: パース済みオブジェクト | null, content: frontmatterを除いた本文 }
  → md.render(content) で本文だけをレンダリング
  → { html, frontmatter: data } を返す
    → MarkdownViewer.svelteがframontmatterStore.set(data)
      → TOCPanel.svelteが上部に表示
```

---

## 2. 未決定事項の確定

- **表示場所**: TOCパネル（`TOCPanel.svelte`）の見出し一覧の上に、`<details>`によるネイティブ折りたたみセクションとして表示する。既存の「文書構造を右パネルに集約する」UIパターンと一貫させる。frontmatterが存在しないファイルではセクションごと非表示にする
- **初期状態**: デフォルトで閉じる（`open`属性なし）。開いたままだと目次一覧がその分下に押しやられてしまうため
- **YAMLパーサー**: `js-yaml`（MITライセンス、標準的で軽量）を新規依存として追加する

---

## 3. 依存追加

```bash
npm install js-yaml
npm install -D @types/js-yaml
```

---

## 4. `src/lib/markdown/frontmatter.ts`（新規）

```typescript
import { load } from "js-yaml";

export interface FrontmatterResult {
  data: Record<string, unknown> | null;
  content: string; // frontmatterブロックを取り除いた残りのMarkdown
}

// ファイル先頭の --- ... --- ブロックのみを対象とする（本文中の水平線とは区別するため
// 文字列の先頭からのみマッチさせる）
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function extractFrontmatter(raw: string): FrontmatterResult {
  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) return { data: null, content: raw };

  try {
    const parsed = load(match[1]);
    // マッピング（オブジェクト）として解析できた場合のみメタデータとして扱う
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, content: raw.slice(match[0].length) };
    }
    return { data: null, content: raw };
  } catch (e) {
    console.warn("frontmatter YAML parse error:", e);
    return { data: null, content: raw };
  }
}
```

- 解析に失敗、またはマッピング以外（スカラー/配列単体）の場合は`content`を元のまま返す。これにより、解析できないfrontmatterは従来通り（崩れた表示のまま）残るが、クラッシュはしない
- 本文中に登場する水平線（`---`）は、正規表現が文字列**先頭**からのみマッチするため誤って除去されない

---

## 5. `src/lib/markdown/engine.ts` の変更

```diff
+import { extractFrontmatter } from "./frontmatter";
+
+export interface RenderResult {
+  html: string;
+  frontmatter: Record<string, unknown> | null;
+}

-export async function renderMarkdown(raw: string, renderers: RendererSettings): Promise<string> {
+export async function renderMarkdown(
+  raw: string,
+  renderers: RendererSettings
+): Promise<RenderResult> {
   const version = ++currentRenderVersion;
   const highlighter = await getHighlighter();
   if (version !== currentRenderVersion) {
-    return "";
+    return { html: "", frontmatter: null };
   }
+
+  const { data: frontmatter, content } = extractFrontmatter(raw);

   const md = new MarkdownIt({ ... });
   ...

   await new Promise<void>((resolve) => setTimeout(resolve, 0));
   if (version !== currentRenderVersion) {
-    return "";
+    return { html: "", frontmatter: null };
   }

   try {
-    return sanitizeHtml(md.render(raw));
+    return { html: sanitizeHtml(md.render(content)), frontmatter };
   } catch (e) {
     console.error("markdown-it render error:", e);
     throw e;
   }
}
```

キャンセル時（`html: ""`）はfrontmatterも`null`を返す。呼び出し側は既存通り`html === ""`でキャンセル済みレンダリングを判定する。

---

## 6. `src/lib/stores/frontmatter.svelte.ts`（新規）

```typescript
export type FrontmatterData = Record<string, unknown>;

function createFrontmatterStore() {
  let data = $state<FrontmatterData | null>(null);

  return {
    get data() {
      return data;
    },
    set(value: FrontmatterData | null) {
      data = value;
    },
  };
}

export const frontmatterStore = createFrontmatterStore();
```

---

## 7. `MarkdownViewer.svelte` の変更

`readingStatsStore`と同じ扱いで、レンダリング結果の分岐すべてに追記する。

```diff
+import { frontmatterStore } from "$lib/stores/frontmatter.svelte";
...
     if (!raw) {
       renderedHtml = "";
       tocStore.setHeadings([]);
       readingStatsStore.set(null);
+      frontmatterStore.set(null);
       return;
     }
...
     renderMarkdown(raw, renderers)
-      .then((html) => {
-        if (html === "") return;
-        renderedHtml = html;
+      .then((result) => {
+        if (result.html === "") return;
+        renderedHtml = result.html;
+        frontmatterStore.set(result.frontmatter);
         isLoading = false;
       })
...
     if (loading || !html) {
       if (!html) {
         tocStore.setHeadings([]);
         readingStatsStore.set(null);
+        frontmatterStore.set(null);
       }
       return;
     }
```

---

## 8. `TOCPanel.svelte` の変更

```diff
+import { frontmatterStore } from "$lib/stores/frontmatter.svelte";
+
+function formatValue(value: unknown): string {
+  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
+}
...
   <div class="flex-1 overflow-y-auto py-1">
+    {#if frontmatterStore.data && Object.keys(frontmatterStore.data).length > 0}
+      <details class="border-b px-3 py-2">
+        <summary class="cursor-pointer text-xs font-semibold text-muted-foreground">
+          メタデータ
+        </summary>
+        <dl class="mt-1 space-y-1">
+          {#each Object.entries(frontmatterStore.data) as [key, value] (key)}
+            <div class="text-xs">
+              <dt class="text-muted-foreground">{key}</dt>
+              <dd class="mt-0.5">
+                {#if Array.isArray(value) && value.every((v) => typeof v !== "object")}
+                  <div class="flex flex-wrap gap-1">
+                    {#each value as item, i (i)}
+                      <span class="rounded-full bg-muted px-2 py-0.5">{String(item)}</span>
+                    {/each}
+                  </div>
+                {:else}
+                  <span class="break-words">{formatValue(value)}</span>
+                {/if}
+              </dd>
+            </div>
+          {/each}
+        </dl>
+      </details>
+    {/if}
     {#if tocStore.headings.length === 0}
       ...
```

---

## 9. データフロー

```
renderMarkdown(raw, renderers)
  → extractFrontmatter(raw) → { data, content }
  → md.render(content) → html
  → { html, frontmatter: data } を返す
    → MarkdownViewer.svelte: frontmatterStore.set(data)
      → TOCPanel.svelte: data があれば<details>セクションを表示
```

---

## 10. 残課題

なし。設計フェーズ完了。表示するフィールドの取捨選択（特定キーの除外・整形）は今回のスコープ外とし、まず実際の見た目を確認してから必要に応じて調整する。
