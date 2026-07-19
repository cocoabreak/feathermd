# 技術設計: コードブロックコピー (code-copy)

## ステータス

完了

---

## 1. 概要

`setupLazyMermaid`（`src/lib/markdown/mermaid-post.ts`）と同じ「レンダリング後にDOMを走査して後処理を付与し、クリーンアップ関数を返す」パターンを踏襲する。新規モジュール `src/lib/markdown/code-copy.ts` を作成し、`.markdown-body` 内の `pre.shiki` 要素をラップしてコピーボタンを注入する。

```
contentEl に {@html renderedHtml} 反映
  → setupCodeCopy(contentEl) が pre.shiki を走査
    → 各 pre を .code-block-wrapper で包み、ボタンを追加
      → クリックで pre 内 code の textContent をクリップボードへ書き込み
```

---

## 2. 未決定事項の確定

- **アイコン**: `@lucide/svelte` の `Copy`/`Check` アイコンのpath dataを直接文字列化したインラインSVGを使う（DOM後処理でのSvelteコンポーネントの動的マウントは複雑になるため、path dataのみ流用してプレーンなSVG文字列を生成する）
- **チェックマーク表示時間**: 1500ms後にコピーアイコンへ戻す

---

## 3. `src/lib/markdown/code-copy.ts`（新規）

```typescript
const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

const RESET_DELAY_MS = 1500;

function handleCopyClick(button: HTMLButtonElement, pre: HTMLPreElement) {
  return async () => {
    const text = pre.querySelector("code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      button.innerHTML = CHECK_ICON;
      button.classList.add("code-copy-success");
      setTimeout(() => {
        button.innerHTML = COPY_ICON;
        button.classList.remove("code-copy-success");
      }, RESET_DELAY_MS);
    } catch (e) {
      console.warn("clipboard write failed:", e);
    }
  };
}

/**
 * コンテナ内の pre.shiki をラップしてコピーボタンを追加する。
 * @returns クリーンアップ関数（現状は解除不要のリスナーのみのため no-op）
 */
export function setupCodeCopy(container: HTMLElement): () => void {
  const blocks = container.querySelectorAll<HTMLPreElement>("pre.shiki");

  blocks.forEach((pre) => {
    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";
    pre.parentElement?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy-button";
    button.innerHTML = COPY_ICON;
    button.setAttribute("aria-label", "コードをコピー");
    button.addEventListener("click", handleCopyClick(button, pre));

    wrapper.appendChild(button);
  });

  return () => {};
}
```

- `pre.shiki` は `engine.ts` の `fence` レンダラーがshikiの `codeToHtml()` をそのまま返しているため確実に付与されているクラス
- Mermaidのプレースホルダー（`.mermaid-pending` → `.mermaid-rendered`のSVG）は `pre.shiki` に一致しないため自動的にスコープ外になる
- `code.textContent` はshikiが行ごとに `<span class="line">` を生成し、行間に実テキストノード `\n` を挟む出力形式のため、装飾タグを除いた元の生コードと一致する（動作確認済み）

---

## 4. `MarkdownViewer.svelte` の変更

### 4.1 スクリプト側

```diff
+import { setupCodeCopy } from "$lib/markdown/code-copy";
...
   let cleanupMermaid: (() => void) | null = null;
+  let cleanupCodeCopy: (() => void) | null = null;
...
     cleanupMermaid?.();
     cleanupMermaid = setupLazyMermaid(contentEl);
+
+    cleanupCodeCopy?.();
+    cleanupCodeCopy = setupCodeCopy(contentEl);
```

### 4.2 スタイル側

```css
.markdown-body :global(.code-block-wrapper) {
  position: relative;
}
.markdown-body :global(.code-copy-button) {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  padding: 0.25rem;
  border-radius: 0.25rem;
  color: #d4d4d4;
  background: rgba(255, 255, 255, 0.1);
  opacity: 0;
  transition: opacity 0.15s;
  cursor: pointer;
}
.markdown-body :global(.code-block-wrapper:hover .code-copy-button) {
  opacity: 1;
}
.markdown-body :global(.code-copy-button:hover) {
  background: rgba(255, 255, 255, 0.2);
}
.markdown-body :global(.code-copy-button.code-copy-success) {
  color: #4ade80;
}
```

- `.code-block-wrapper` に `position: relative` を持たせることで、`pre` 自体の `overflow-x: auto` による横スクロールとは独立してボタンをラッパー基準の右上に固定する（`pre`基準にすると横スクロールでボタンも流れてしまうため）
- 配色はshikiの `dark-plus` テーマ（濃い背景）に合わせた半透明白ベース

---

## 5. データフロー

```
renderedHtml が {@html} でcontentElに反映される（$effect）
  → setupLazyMermaid(contentEl)（既存）
  → setupCodeCopy(contentEl)（新規）: pre.shikiをラップしボタン注入
    → ボタンクリック → pre内codeのtextContentをnavigator.clipboard.writeTextへ
      → 成功: アイコンをCHECKに1500ms切替
      → 失敗: console.warnのみ
```

---

## 6. 残課題

なし。設計フェーズ完了。
