# 技術設計: コンテンツズーム (content-zoom)

## ステータス

完了

---

## 1. 概要

`.markdown-body`（`MarkdownViewer.svelte` のコンテンツ領域）の `font-size` を百分率で可変にする。既存のCSSは見出し・段落等が `em` 単位でコンテンツ領域基準の相対サイズになっているため、コンテナ自体の `font-size` を変えるだけで内部要素全体が連動して拡大縮小される。

```
ズーム率(%) → contentEl の style="font-size: {zoom}%" → 内部のem単位要素が連動して拡大縮小
```

---

## 2. 未決定事項の確定

- **範囲・刻み**: 50%〜200%、10%刻み（デフォルト100%）
- **Ctrl+マウスホイール**: 対応する（`e.ctrlKey` かつ `wheel` イベントで `e.preventDefault()` し、ブラウザ既定のページズームを抑止した上で独自にズームを適用する）
- **StatusBarのUI**: `-` / `+` ボタンは設けず、パーセント表示のみ（クリックでリセット）。キーボード・ホイールで十分操作できるためUIをシンプルに保つ

---

## 3. 状態管理: `settings.svelte.ts` の変更

```typescript
export interface Settings {
  showHiddenFiles: boolean;
  tocVisible: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
  tocWidth: number;
  contentZoom: number; // 追加
  renderers: RendererSettings;
}

export const DEFAULT_CONTENT_ZOOM = 100;
export const MIN_CONTENT_ZOOM = 50;
export const MAX_CONTENT_ZOOM = 200;
export const CONTENT_ZOOM_STEP = 10;

function clampContentZoom(zoom: number): number {
  return Math.min(MAX_CONTENT_ZOOM, Math.max(MIN_CONTENT_ZOOM, zoom));
}

// createSettingsStore() 内に追加
setContentZoom(zoom: number) {
  settings = { ...settings, contentZoom: clampContentZoom(zoom) };
},
zoomIn() {
  this.setContentZoom(settings.contentZoom + CONTENT_ZOOM_STEP);
},
zoomOut() {
  this.setContentZoom(settings.contentZoom - CONTENT_ZOOM_STEP);
},
resetZoom() {
  this.setContentZoom(DEFAULT_CONTENT_ZOOM);
},
```

- `sidebarWidth`/`tocWidth` の `clampPanelWidth` と同様のパターン
- `zoomIn`/`zoomOut`は10%刻みで`setContentZoom`を呼ぶだけの薄いラッパー（コマンド登録・ホイール操作の両方から共有するため）

## 4. 永続化: `settings-store.ts` の変更

- `loadSettings()`: `saved.contentZoom` が number であれば `setContentZoom` を呼ぶ
- `saveSettings()`: 既存実装のまま（`settingsStore.settings` 全体を保存するため変更不要）
- 呼び出しタイミング: キーボードショートカット・StatusBarクリックでの各操作後に都度 `saveSettings()` を呼ぶ。ホイール操作は連続発火するため300msデバウンスしてから呼ぶ（`SearchBar`の入力デバウンスと同様のパターン）

---

## 5. キーボードショートカット

### 5.1 `keymap.ts`

```diff
   "Ctrl+F": "search.open",
+  "Ctrl+=": "view.zoomIn",
+  "Ctrl++": "view.zoomIn",
+  "Ctrl+Shift++": "view.zoomIn", // 主要キーボード配列でCtrl+Shift+=を押した場合（Shiftで"+"になる）を吸収
+  "Ctrl+-": "view.zoomOut",
+  "Ctrl+0": "view.zoomReset",
   "Ctrl+,": "settings.open",
```

### 5.2 `builtin.ts`

```diff
+import { saveSettings } from "$lib/settings-store";
+
+registerCommand({
+  id: "view.zoomIn",
+  run: () => {
+    settingsStore.zoomIn();
+    saveSettings();
+  },
+});
+registerCommand({
+  id: "view.zoomOut",
+  run: () => {
+    settingsStore.zoomOut();
+    saveSettings();
+  },
+});
+registerCommand({
+  id: "view.zoomReset",
+  run: () => {
+    settingsStore.resetZoom();
+    saveSettings();
+  },
+});
```

---

## 6. `MarkdownViewer.svelte` の変更

### 6.1 コンテンツ領域への適用

```svelte
<div
  bind:this={contentEl}
  role="main"
  class="markdown-body flex-1 overflow-y-auto px-8 py-6"
  style="scrollbar-gutter: stable; font-size: {settingsStore.settings.contentZoom}%"
  onclick={handleClick}
  onscroll={handleScroll}
  onwheel={handleWheel}
>
```

### 6.2 Ctrl+ホイールでのズーム

```typescript
let zoomSaveTimer: ReturnType<typeof setTimeout>;

function handleWheel(e: WheelEvent) {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (e.deltaY < 0) settingsStore.zoomIn();
  else if (e.deltaY > 0) settingsStore.zoomOut();

  clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(() => saveSettings(), 300);
}
```

- `saveSettings` は `settings-store.ts` からimportする
- キーボードショートカット（`builtin.ts`経由）は都度即座に保存、ホイールのみデバウンスする（操作頻度が異なるため）

---

## 7. `StatusBar.svelte` の変更

```svelte
<script lang="ts">
  import { tabStore } from "$lib/stores/tab.svelte";
  import { settingsStore } from "$lib/stores/settings.svelte";
  import { saveSettings } from "$lib/settings-store";

  const activeTab = $derived(tabStore.tabs.find((t) => t.id === tabStore.activeTabId));

  function resetZoom() {
    settingsStore.resetZoom();
    saveSettings();
  }
</script>

<footer class="flex h-6 shrink-0 items-center border-t bg-muted/30 px-3 text-xs text-muted-foreground">
  {#if activeTab}
    <span class="truncate">{activeTab.path}</span>
  {:else}
    <span>準備完了</span>
  {/if}

  <div class="flex-1"></div>

  <button onclick={resetZoom} class="hover:text-foreground" title="クリックでリセット">
    {settingsStore.settings.contentZoom}%
  </button>
</footer>
```

---

## 8. データフロー

```
Ctrl+=/Ctrl++/Ctrl+Shift++ → view.zoomIn → settingsStore.zoomIn() → saveSettings()
Ctrl+-                     → view.zoomOut → settingsStore.zoomOut() → saveSettings()
Ctrl+0                     → view.zoomReset → settingsStore.resetZoom() → saveSettings()
Ctrl+ホイール               → handleWheel → settingsStore.zoomIn()/zoomOut() → 300msデバウンス後saveSettings()
StatusBarのパーセント表示クリック → resetZoom() → settingsStore.resetZoom() → saveSettings()

settingsStore.settings.contentZoom変更
  → MarkdownViewer.svelte: contentEl の style="font-size: {contentZoom}%" に反映（テンプレートの通常のリアクティブ更新、$effect不要）
  → StatusBar.svelte: パーセント表示に反映
```

---

## 9. 残課題

なし。設計フェーズ完了。
