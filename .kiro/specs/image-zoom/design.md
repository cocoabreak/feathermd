# 技術設計: 画像・Mermaidズーム (image-zoom)

## ステータス

完了

---

## 1. 概要

グローバルな `lightboxStore` と、`+page.svelte` に1つだけマウントする `Lightbox.svelte` を新設する。起動トリガーは`code-copy`と同じ「レンダリング後にDOMを走査し、ホバー時に表示されるアイコンボタンを注入する」パターンを使う（詳細は「9. 起動トリガーの変更」）。

```
画像/Mermaid図にホバー → 展開アイコンが表示される
  → アイコンをクリック
  → lightboxStore.openImage(src, alt) / openSvg(svgOuterHtml)
  → {#if lightboxStore.open}<Lightbox />{/if} が表示される
  → ホイールでズーム・ドラッグでパン・ダブルクリックでリセット
  → Escape/背景クリック/✕ボタンで閉じる
```

---

## 2. 未決定事項の確定

- **ズーム範囲**: 下限25%のみ設定し、上限は設けない（実装中のフィードバックにより変更。細部を際限なく拡大して確認したいニーズがあるため）。初期表示（100%）は「画面に収まるサイズ」を基準とし、そこから乗算的にズームする（`max-width: 90vw; max-height: 90vh; object-fit: contain` で自然にフィットさせた上に `transform: scale()` を重ねる）
- **タッチ操作**: 対象外（v1はマウスホイール・ドラッグのみ）
- **マウントの場所**: `+page.svelte` に `SettingsPanel` と同様の全画面オーバーレイとしてグローバルに1つマウントする（`MarkdownViewer.svelte` 内部に置くと、コンテンツ領域のスクロール・z-index文脈に引きずられるため）
- **背景・レイアウト**: 実装中のフィードバックにより2層構成に変更。外側は画面全体を覆う半透明スクリム（`bg-black/60`）とし、元のコンテンツがうっすら透けて見えることでポップアップであることを分かりやすくする。内側は画面の75%サイズの不透明な「ステージ」とし、画像/図はここに収まる（ズームしてもoverflow-hiddenではみ出さない）。ステージの背景色は当初 `bg-neutral-950`（濃色固定）を検討したが、Mermaidの描画は明るい背景を前提とした文字色になっているため黒背景では文字が読めなくなる問題があった。アプリのテーマCSS変数 `bg-background` を採用することで、現状（ダークモード切替は未実装のため実質白背景）でMermaidの文字が読めることに加え、将来ダークモード切替機能を実装した際にライトボックスも自動的に追従するようにした

---

## 3. 状態管理: `lightbox.svelte.ts`

`app/src/lib/stores/lightbox.svelte.ts` を新規作成（`ui.svelte.ts`と同様、非永続）。

```typescript
type LightboxContent =
  | { type: "image"; src: string; alt: string }
  | { type: "svg"; html: string };

function createLightboxStore() {
  let content = $state<LightboxContent | null>(null);

  return {
    get content() {
      return content;
    },
    get open() {
      return content !== null;
    },
    openImage(src: string, alt: string) {
      content = { type: "image", src, alt };
    },
    openSvg(html: string) {
      content = { type: "svg", html };
    },
    close() {
      content = null;
    },
  };
}

export const lightboxStore = createLightboxStore();
```

---

## 4. 起動トリガー: `image-lightbox-trigger.ts`（新規、2026-07-03改訂）

当初は `handleClick` での画像/Mermaid SVGクリック検知だったが、バッジ画像等での誤クリックが煩わしいというフィードバックにより、`code-copy.ts`（`setupCodeCopy`）と同じ「レンダリング後にDOMを走査し、ホバー時に表示されるアイコンボタンを注入する」パターンに変更する。`handleClick` からは画像/Mermaid SVGの早期returnブロックを削除し、通常のリンク処理に委ねる。

```typescript
import { lightboxStore } from "$lib/stores/lightbox.svelte";

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/></svg>`;

function createExpandButton(onOpen: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lightbox-trigger-button";
  button.innerHTML = EXPAND_ICON;
  button.setAttribute("aria-label", "拡大表示");
  button.addEventListener("click", (e) => {
    // 画像がリンクで囲まれている場合、リンク遷移よりライトボックス表示を優先する
    e.preventDefault();
    e.stopPropagation();
    onOpen();
  });
  return button;
}

/** 画像用: inline-blockのラッパーspanで包む（バッジ画像等の横並び表示を崩さないため、displayをblockにはしない） */
export function setupImageLightboxTrigger(container: HTMLElement): () => void {
  container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const wrapper = document.createElement("span");
    wrapper.className = "lightbox-trigger-wrapper";
    img.parentElement?.insertBefore(wrapper, img);
    wrapper.appendChild(img);
    wrapper.appendChild(createExpandButton(() => lightboxStore.openImage(img.src, img.alt)));
  });

  return () => {};
}

/** Mermaid用: 個別のレンダリング完了時にmermaid-post.tsから呼び出す（下記参照） */
export function addMermaidExpandButton(mermaidEl: HTMLElement): void {
  const svg = mermaidEl.querySelector("svg");
  if (!svg) return;
  mermaidEl.appendChild(createExpandButton(() => lightboxStore.openSvg(svg.outerHTML)));
}
```

- `img.src` の時点で、既存のsecurity-hardening機能によりローカル画像は既にbase64データURLに変換済みのため、そのままライトボックスへ渡せる
- `svg.outerHTML` は、Markdownレンダリング時に既にDOMPurifyでサニタイズ済みのDOMから複製した文字列であり、新たな未検証HTMLではない（非機能要求の安全性要件を満たす）
- `wrapper`（画像用）は `display: inline-block; position: relative` とし、画像本体の `display: inline`（GitHub互換のバッジ横並び表示のための既存修正）による行内フローを保ったまま、ボタンを絶対配置できるようにする
- `.mermaid-rendered` は既存で `display: flex` のブロックコンテナのため、`position: relative` を追加するだけでよい

### 4.1 Mermaidは遅延レンダリングのため個別コールバックが必要

Mermaid図は `setupLazyMermaid`（`mermaid-post.ts`）により`IntersectionObserver`で画面内に入った時点で個別に非同期レンダリングされる。そのため、レンダリング直後に一括で`.mermaid-rendered`を走査してもスクロールしないと現れない図には間に合わない。`mermaid-post.ts`の`renderOne()`内、`el.classList.replace("mermaid-processing", "mermaid-rendered")`の直後で`addMermaidExpandButton(el)`を呼び出すことで、個々の図が実際にレンダリングされた瞬間にボタンを追加する。

```diff
   el.innerHTML = svg;
   el.classList.replace("mermaid-processing", "mermaid-rendered");
+  addMermaidExpandButton(el);
```

- `MarkdownViewer.svelte` 側では画像用の `setupImageLightboxTrigger(contentEl)` のみ呼べばよい（Mermaid側は`mermaid-post.ts`が自律的に処理するため、`MarkdownViewer.svelte`からの追加の呼び出しは不要）

---

## 5. `Lightbox.svelte`（新規コンポーネント）

`app/src/lib/components/Lightbox.svelte`。`+page.svelte` に `{#if lightboxStore.open}<Lightbox />{/if}` として1箇所だけマウントする（`SettingsPanel`と同様のパターン）。

```svelte
<script lang="ts">
  import { lightboxStore } from "$lib/stores/lightbox.svelte";

  const MIN_ZOOM = 0.25;

  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") lightboxStore.close();
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoom = Math.max(MIN_ZOOM, zoom * delta);
  }

  function handlePointerDown(e: PointerEvent) {
    dragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
  }

  function handlePointerUp() {
    dragging = false;
  }
</script>

<!-- 外側: 半透明スクリム。元のコンテンツをうっすら透けさせ、ポップアップであることを分かりやすくする -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="presentation"
  class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
  onclick={(e) => {
    if (e.target === e.currentTarget) lightboxStore.close();
  }}
>
  <button
    onclick={() => lightboxStore.close()}
    class="absolute right-4 top-4 rounded p-2 text-2xl text-white/80 hover:text-white"
    aria-label="閉じる"
  >
    ✕
  </button>

  <!-- 内側: 常に不透明なステージ。アプリのテーマCSS変数(bg-background)を使うことで、
       Mermaidの描画（明るい背景前提の文字色）でも読みやすく、将来ダークモード切替を
       実装した際にも自動追従する -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative h-[75vh] w-[75vw] cursor-grab overflow-hidden rounded-lg bg-background active:cursor-grabbing"
    onwheel={handleWheel}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    ondblclick={resetView}
  >
    <div
      class="flex h-full w-full items-center justify-center"
      style="transform: translate({panX}px, {panY}px) scale({zoom})"
    >
      {#if lightboxStore.content?.type === "image"}
        <img
          src={lightboxStore.content.src}
          alt={lightboxStore.content.alt}
          class="max-h-full max-w-full object-contain"
          draggable="false"
        />
      {:else if lightboxStore.content?.type === "svg"}
        <div class="max-h-full max-w-full [&_svg]:max-h-[75vh] [&_svg]:max-w-[75vw]">
          {@html lightboxStore.content.html}
        </div>
      {/if}
    </div>
  </div>
</div>
```

- 外側スクリム（`bg-black/60`）のクリックは `e.target === e.currentTarget` で「スクリムそのもの」を叩いたときだけ閉じる。内側ステージ（`h-[75vh] w-[75vw]`）は常に不透明background（`bg-background`）で、画像/図はこのステージ内にoverflow-hiddenでクリップされる（ズームしてもステージ外へはみ出さない）
- ✕ボタン・外側スクリムクリック・Escapeの3経路で閉じられる（US-003）。ステージ内側でのクリックはドラッグ操作と干渉するため閉じる対象にしない
- ドラッグは `pointerdown/move/up` + `setPointerCapture`（`ResizeHandle.svelte`と同じ実装パターン）でステージ全体に対して行う（画像/図の直上に限らずステージ内どこでもパンできる）
- ダブルクリックで `resetView()`（US-002）
- `zoom`/`panX`/`panY` はコンポーネントローカルの `$state`。`{#if lightboxStore.open}` により開くたびに新規マウントされるため、開き直すたびに自動的に初期値（zoom=1, pan=0,0）にリセットされる

---

## 6. `+page.svelte` の変更

```diff
   import SettingsPanel from "$lib/components/SettingsPanel.svelte";
+  import Lightbox from "$lib/components/Lightbox.svelte";
   import { settingsStore } from "$lib/stores/settings.svelte";
+  import { lightboxStore } from "$lib/stores/lightbox.svelte";
```

```diff
 {#if uiStore.settingsPanelOpen}
   <SettingsPanel onclose={() => uiStore.closeSettings()} />
 {/if}
+
+{#if lightboxStore.open}
+  <Lightbox />
+{/if}
```

---

## 7. データフロー

```
画像レンダリング直後
  → MarkdownViewer.svelteの$effect内でsetupImageLightboxTrigger(contentEl)
    → 各imgをinline-blockラッパーで包み展開アイコンを追加

Mermaid図が遅延レンダリング完了
  → mermaid-post.tsのrenderOne()内でaddMermaidExpandButton(el)
    → .mermaid-renderedに展開アイコンを追加

展開アイコンクリック
  → e.preventDefault() / e.stopPropagation()（リンクで囲まれていても遷移させない）
  → lightboxStore.openImage/openSvg
  → +page.svelteの{#if lightboxStore.open}でLightboxマウント
  → 開いた瞬間 zoom=1, pan=0,0（画面フィット表示）

ホイール → handleWheel → zoom更新（0.25〜4でクランプ、transformに反映）
ドラッグ → pointermove → panX/panY更新（transformに反映）
ダブルクリック → resetView() → zoom=1, pan=0,0に戻る

Escape / 背景クリック / ✕ボタン → lightboxStore.close() → Lightboxアンマウント
```

---

## 8. `MarkdownViewer.svelte` の `handleClick` 簡略化

画像/Mermaid SVGの早期returnブロックを削除し、通常のリンク処理のみを残す。

```diff
   async function handleClick(event: MouseEvent) {
     const target = event.target as HTMLElement;

-    const img = target.closest("img");
-    if (img instanceof HTMLImageElement) {
-      event.preventDefault();
-      lightboxStore.openImage(img.src, img.alt);
-      return;
-    }
-    const mermaidSvg = target.closest(".mermaid-rendered svg");
-    if (mermaidSvg instanceof SVGSVGElement) {
-      event.preventDefault();
-      lightboxStore.openSvg(mermaidSvg.outerHTML);
-      return;
-    }
-
     const anchor = target.closest("a");
     // ...既存のリンク処理はそのまま
```

- 画像本体（アイコン以外）のクリックは、リンクで囲まれていれば通常どおり`handleClick`のアンカー処理でリンク遷移し、囲まれていなければ何も起きない（改訂後のUS-001の受け入れ条件どおり）

---

## 9. CSS: `MarkdownViewer.svelte`

```css
.markdown-body :global(.lightbox-trigger-wrapper) {
  position: relative;
  display: inline-block;
}
.markdown-body :global(.mermaid-rendered) {
  position: relative; /* 既存のdisplay:flexに追加 */
}
.markdown-body :global(.lightbox-trigger-button) {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  padding: 0.25rem;
  border-radius: 0.25rem;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.15s;
  cursor: pointer;
}
.markdown-body :global(.lightbox-trigger-wrapper:hover .lightbox-trigger-button),
.markdown-body :global(.mermaid-rendered:hover .lightbox-trigger-button) {
  opacity: 1;
}
```

- `code-copy-button` と同系統の見た目（半透明の黒背景・白アイコン・ホバーで表示）だが、画像は明るい背景のことが多いため黒背景ベースにする（コードブロックは逆にダークテーマなので白背景ベース）

---

## 10. 残課題

なし。設計フェーズ完了。
