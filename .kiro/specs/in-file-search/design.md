# 技術設計: ファイル内検索 (in-file-search)

## ステータス

完了

---

## 1. 概要

`Ctrl+F` で検索バーを開き、`MarkdownViewer.svelte` がレンダリングしたDOM（`contentEl`）のテキストノードを走査してマッチ箇所を `<mark>` 要素でラップする。Markdownソースではなくレンダリング後のDOMを対象にすることで、コードブロックや表のセル内も含めて検索できる。

```
Ctrl+F → searchStore.openSearch()
検索語入力（デバウンス） → searchStore.setQuery()
  → $effect: contentEl のテキストノードを走査し <mark class="search-match"> でラップ
  → 現在地には .search-match-current を追加してscrollIntoView
次候補/前候補 → searchStore.next() / prev()（currentIndexのみ変更、再走査はしない）
```

---

## 2. 未決定事項の確定

- **大文字小文字**: 常に区別しない（`RegExp` の `i` フラグを常に付与。トグルは設けない。KISS）
- **ハイライト実装方式**: `document.createTreeWalker` でテキストノードを収集し、マッチ箇所を `<mark>` で置換する方式（`innerHTML` の文字列置換は既存のイベントリスナー・Mermaid描画結果・シンタックスハイライトのDOM構造を破壊するため不可）
- **UI配置**: コンテンツ領域右上に絶対配置するオーバーレイバー（VSCode の検索バーに近い配置）

---

## 3. 状態管理: `search.svelte.ts`

`app/src/lib/stores/search.svelte.ts` を新規作成（`ui.svelte.ts` と同様、非永続）。

```typescript
function createSearchStore() {
  let open = $state(false);
  let query = $state("");
  let useRegex = $state(false);
  let matchCount = $state(0);
  let currentIndex = $state(-1); // -1 = マッチなし
  let error = $state<string | null>(null);

  return {
    get open() {
      return open;
    },
    get query() {
      return query;
    },
    get useRegex() {
      return useRegex;
    },
    get matchCount() {
      return matchCount;
    },
    get currentIndex() {
      return currentIndex;
    },
    get error() {
      return error;
    },
    openSearch() {
      open = true;
    },
    closeSearch() {
      // queryは残す（再度Ctrl+Fで開いたときに前回検索語を再利用できる）
      open = false;
      matchCount = 0;
      currentIndex = -1;
      error = null;
    },
    setQuery(q: string) {
      query = q;
    },
    toggleRegex() {
      useRegex = !useRegex;
    },
    setResult(count: number, err: string | null) {
      matchCount = count;
      error = err;
      currentIndex = count > 0 ? 0 : -1;
    },
    next() {
      if (matchCount === 0) return;
      currentIndex = (currentIndex + 1) % matchCount;
    },
    prev() {
      if (matchCount === 0) return;
      currentIndex = (currentIndex - 1 + matchCount) % matchCount;
    },
  };
}

export const searchStore = createSearchStore();
```

---

## 4. ハイライトロジック: `search-highlight.ts`

`app/src/lib/markdown/search-highlight.ts` を新規作成（純粋なDOM操作関数、Svelteに依存しない）。

```typescript
export interface HighlightResult {
  marks: HTMLElement[];
  error: string | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 既存のハイライトmark要素を取り除き、テキストノードに戻す */
export function clearHighlights(container: HTMLElement): void {
  container.querySelectorAll("mark.search-match").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

/** containerのテキストノードを走査し、queryにマッチする箇所を<mark>でラップする */
export function applyHighlights(
  container: HTMLElement,
  query: string,
  useRegex: boolean
): HighlightResult {
  if (!query) return { marks: [], error: null };

  let regex: RegExp;
  try {
    regex = new RegExp(useRegex ? query : escapeRegExp(query), "gi");
  } catch (e) {
    return { marks: [], error: e instanceof Error ? e.message : "無効な正規表現です" };
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  const marks: HTMLElement[] = [];

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    regex.lastIndex = 0;
    const found: { index: number; length: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      if (m[0].length === 0) {
        regex.lastIndex++; // 空文字マッチ（例: /a*/）での無限ループ防止
        continue;
      }
      found.push({ index: m.index, length: m[0].length });
    }
    if (found.length === 0) continue;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const { index, length } of found) {
      if (index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, index)));
      const mark = document.createElement("mark");
      mark.className = "search-match";
      mark.textContent = text.slice(index, index + length);
      frag.appendChild(mark);
      marks.push(mark);
      cursor = index + length;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));

    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return { marks, error: null };
}
```

- `TreeWalker` でテキストノードを**先に全件収集してから**DOM置換する（走査中にDOMを書き換えると `nextNode()` が正しく辿れなくなるため）
- 正規表現モードでない場合は特殊文字をエスケープしたリテラル検索にする
- `i` フラグを常に付与し、大文字小文字を区別しない（§2で確定）

---

## 5. `MarkdownViewer.svelte` への統合

### 5.1 ハイライト適用・現在地更新の2つの`$effect`

既存の重い後処理effect（スクロール復元・TOC構築・Mermaid・画像変換）とは**別の**軽量なeffectに分離する。同じeffectに混ぜると検索語入力のたびにスクロール位置復元やMermaid再セットアップが走ってしまうため。

```typescript
import { searchStore } from "$lib/stores/search.svelte";
import { applyHighlights, clearHighlights } from "$lib/markdown/search-highlight";

let currentMarks: HTMLElement[] = []; // 他の imperative なDOMハンドル（observer等）と同じく通常変数

// 検索語・正規表現モード・開閉・コンテンツ変更のたびに再走査
$effect(() => {
  const query = searchStore.query;
  const useRegex = searchStore.useRegex;
  const isOpen = searchStore.open;
  const html = renderedHtml; // タブ切り替え・ファイル更新時に再走査するための依存
  if (!contentEl) return;

  clearHighlights(contentEl);
  currentMarks = [];

  if (!isOpen || !query) {
    searchStore.setResult(0, null);
    return;
  }

  const { marks, error } = applyHighlights(contentEl, query, useRegex);
  currentMarks = marks;
  searchStore.setResult(marks.length, error);
  void html; // 依存として利用するだけで値は使わない
});

// 現在地マッチの切り替え（次候補/前候補）。再走査はせずクラス付け替えのみ
$effect(() => {
  const idx = searchStore.currentIndex;
  currentMarks.forEach((m) => m.classList.remove("search-match-current"));
  const el = currentMarks[idx];
  if (el) {
    el.classList.add("search-match-current");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
```

- 1つ目のeffectは `searchStore.setResult()` を呼ぶことで `currentIndex` を更新し、2つ目のeffectが連動して現在地へスクロールする
- タブ切り替え時（`renderedHtml` 変更）も1つ目のeffectが再走査するため、US-004（アクティブタブへの追従）を満たす

### 5.2 テンプレートの変更

検索バーをオーバーレイ表示するため、コンテンツ領域を `relative` なラッパーで囲む。

```svelte
<div class="relative flex min-h-0 flex-1 flex-col">
  {#if searchStore.open}
    <SearchBar />
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={contentEl}
    role="main"
    class="markdown-body flex-1 overflow-y-auto px-8 py-6"
    style="scrollbar-gutter: stable"
    onclick={handleClick}
    onscroll={handleScroll}
  >
    <!-- 既存のまま -->
  </div>
</div>
```

### 5.3 ハイライトのスタイル

`{@html renderedHtml}` 同様、`<mark>` はSvelteのテンプレートコンパイル対象外（動的DOM操作で挿入）のため `:global()` が必要。

```css
.markdown-body :global(mark.search-match) {
  background-color: hsl(48, 96%, 68%);
  color: inherit;
  border-radius: 2px;
}
.markdown-body :global(mark.search-match-current) {
  background-color: hsl(24, 94%, 58%);
}
```

---

## 6. `SearchBar.svelte`（新規コンポーネント）

`app/src/lib/components/SearchBar.svelte`。

```svelte
<script lang="ts">
  import { searchStore } from "$lib/stores/search.svelte";

  let inputEl: HTMLInputElement;
  let localQuery = $state(searchStore.query);
  let debounceTimer: ReturnType<typeof setTimeout>;

  $effect(() => {
    inputEl?.focus();
    inputEl?.select();
  });

  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchStore.setQuery(localQuery), 150);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      searchStore.closeSearch();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) searchStore.prev();
      else searchStore.next();
    }
  }
</script>

<div
  class="absolute right-3 top-3 z-10 flex items-center gap-1 rounded border bg-background p-1.5 shadow-md"
>
  <input
    bind:this={inputEl}
    bind:value={localQuery}
    oninput={handleInput}
    onkeydown={handleKeydown}
    type="text"
    placeholder="検索"
    class="w-48 rounded border px-2 py-1 text-xs"
  />

  <button
    onclick={() => searchStore.toggleRegex()}
    class="rounded px-1.5 py-1 text-xs"
    class:bg-accent={searchStore.useRegex}
    title="正規表現"
    aria-label="正規表現モード切り替え"
    aria-pressed={searchStore.useRegex}
  >
    .*
  </button>

  <span class="w-14 text-center text-xs text-muted-foreground">
    {#if searchStore.error}
      無効
    {:else if searchStore.matchCount === 0}
      0/0
    {:else}
      {searchStore.currentIndex + 1}/{searchStore.matchCount}
    {/if}
  </span>

  <button
    onclick={() => searchStore.prev()}
    disabled={searchStore.matchCount === 0}
    class="rounded px-1.5 py-1 text-xs disabled:opacity-40"
    title="前候補"
    aria-label="前候補"
  >
    ↑
  </button>
  <button
    onclick={() => searchStore.next()}
    disabled={searchStore.matchCount === 0}
    class="rounded px-1.5 py-1 text-xs disabled:opacity-40"
    title="次候補"
    aria-label="次候補"
  >
    ↓
  </button>
  <button
    onclick={() => searchStore.closeSearch()}
    class="rounded px-1.5 py-1 text-xs"
    title="閉じる"
    aria-label="検索バーを閉じる"
  >
    ✕
  </button>
</div>
```

- `localQuery` はコンポーネントローカルの `$state`。`{#if searchStore.open}` により開閉のたびにコンポーネントが再マウントされるため、マウント時に `searchStore.query`（前回値）を正しく引き継げる（既存のpanel-resize修正で学んだ「マウント時一度きりの初期値コピー」の罠は、非同期な外部更新が入らないこの用途では問題にならない）
- 入力は150msデバウンスしてから `searchStore.setQuery()` に反映し、大きめのファイルでの入力毎の全文再走査を抑える
- `Escape` はこの `<input>` のローカル `onkeydown` で処理する。グローバルショートカット（`+page.svelte`）は `input` へのフォーカス中は発火しない設計のため、既存の `Escape → settings.close` と衝突しない

---

## 7. キーボードショートカット統合

### 7.1 `keymap.ts`

```diff
   "Ctrl+B": "panel.toggleSidebar",
   "Ctrl+J": "panel.toggleToc",
+  "Ctrl+F": "search.open",
   "Ctrl+,": "settings.open",
```

### 7.2 `builtin.ts`

```diff
+import { searchStore } from "$lib/stores/search.svelte";
+
+registerCommand({ id: "search.open", run: () => searchStore.openSearch() });
```

---

## 8. データフロー

```
Ctrl+F → searchStore.openSearch() → SearchBar マウント → 検索欄にフォーカス

検索欄に入力（150msデバウンス） → searchStore.setQuery()
  → $effect: clearHighlights → applyHighlights → currentMarks更新
  → searchStore.setResult(count, error) → currentIndex = 0（マッチありの場合）
  → 2つ目のeffect: currentMarks[0] に .search-match-current 付与 → scrollIntoView

次候補ボタン/Enter → searchStore.next() → currentIndex変更のみ
  → 2つ目のeffectのみ再実行（再走査なし）→ クラス付け替え・スクロール

タブ切り替え（renderedHtml変更） → 1つ目のeffectが再走査（US-004）

Escape/閉じるボタン → searchStore.closeSearch() → SearchBarアンマウント
  → open=falseになり1つ目のeffectが再実行 → clearHighlights → setResult(0, null)
```

---

## 9. 残課題

なし。設計フェーズ完了。
