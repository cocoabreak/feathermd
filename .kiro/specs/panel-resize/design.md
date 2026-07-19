# 技術設計: パネルリサイズ (panel-resize)

## ステータス

完了

---

## 1. 概要

`Sidebar.svelte`（現状 `w-56` 固定）と `TOCPanel.svelte`（現状 `w-52` 固定）に、境界ドラッグでの幅変更機能を追加する。
幅は `settingsStore` で管理し、既存の `tauri-plugin-store` 永続化の仕組み（`settings-store.ts`）に乗せる。

---

## 2. 最小幅・最大幅（未決定事項の確定）

| パネル | デフォルト | 最小 | 最大 |
|---|---|---|---|
| Sidebar | 224px（現状の `w-56` 相当） | 160px | 480px |
| TOCPanel | 208px（現状の `w-52` 相当） | 160px | 480px |

- 固定の絶対値でクランプする（ウィンドウ幅に対する相対計算は行わない。KISS優先）。
- コンテンツ領域（`MarkdownViewer`）は既存の `flex-1 min-w-0` により、両パネルが最大まで広がっても潰れずスクロール表示に切り替わる。

## 3. リサイズハンドルの視覚仕様（未決定事項の確定）

- 通常時は透明（幅4px、`cursor-col-resize`）、hover時のみ `bg-primary/40` 相当を表示
- ダブルクリックでデフォルト幅にリセットする（軽微な機能でコストが低いため採用）

---

## 4. コンポーネント設計

### 4.1 新規共通コンポーネント: `ResizeHandle.svelte`

`app/src/lib/components/ResizeHandle.svelte` として新規作成し、Sidebar・TOCPanel の両方から使う。

```svelte
<script lang="ts">
  interface Props {
    edge: "left" | "right"; // ハンドルがどちら側の境界か（ドラッグ方向の符号に影響）
    width: number;
    min: number;
    max: number;
    defaultWidth: number;
    onchange: (width: number) => void; // ドラッグ中: 都度呼ぶ（描画用）
    oncommit: (width: number) => void; // ドラッグ終了時: 永続化用
  }
  let { edge, width, min, max, defaultWidth, onchange, oncommit }: Props = $props();

  let dragging = $state(false);

  function clamp(value: number) {
    return Math.min(max, Math.max(min, value));
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const delta = edge === "right" ? e.movementX : -e.movementX;
    onchange(clamp(width + delta));
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    oncommit(width);
  }

  function onDblClick() {
    onchange(defaultWidth);
    oncommit(defaultWidth);
  }
</script>

<div
  role="separator"
  aria-orientation="vertical"
  class="group w-1 shrink-0 cursor-col-resize"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  ondblclick={onDblClick}
>
  <div class="h-full w-px bg-transparent group-hover:bg-primary/40"></div>
</div>
```

`setPointerCapture` によりドラッグ中は要素外にマウスが出ても `pointermove` を受け続けられるため、`window` レベルのイベントリスナー登録は不要。

### 4.2 `Sidebar.svelte` の変更

- 固定クラス `w-56` を削除し、`style="width: {settingsStore.settings.sidebarWidth}px"` に変更
- `<aside>` の右側（flex兄弟要素として）に `<ResizeHandle edge="right" ... />` を配置

### 4.3 `TOCPanel.svelte` の変更

- 固定クラス `w-52` を削除し、`style="width: {settingsStore.settings.tocWidth}px"` に変更
- `<aside>` の左側（flex兄弟要素として）に `<ResizeHandle edge="left" ... />` を配置

---

## 5. 状態管理設計

### 5.1 `settings.svelte.ts` の変更

```typescript
export interface Settings {
  showHiddenFiles: boolean;
  tocVisible: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number; // 追加
  tocWidth: number;     // 追加
  renderers: RendererSettings;
}

const DEFAULT_SIDEBAR_WIDTH = 224;
const DEFAULT_TOC_WIDTH = 208;
const MIN_PANEL_WIDTH = 160;
const MAX_PANEL_WIDTH = 480;

// createSettingsStore() 内に追加
setSidebarWidth(width: number) {
  settings = { ...settings, sidebarWidth: clampPanelWidth(width) };
},
setTocWidth(width: number) {
  settings = { ...settings, tocWidth: clampPanelWidth(width) };
},
```

`clampPanelWidth` はモジュール内のプライベート関数として `MIN_PANEL_WIDTH` / `MAX_PANEL_WIDTH` を用いる。

### 5.2 `settings-store.ts`（永続化）の変更

- `loadSettings()`: `saved.sidebarWidth` / `saved.tocWidth` が number であれば `setSidebarWidth` / `setTocWidth` を呼ぶ
- `saveSettings()`: 既存実装のまま（`settingsStore.settings` 全体を保存するため変更不要）
- 呼び出しタイミング: `ResizeHandle` の `oncommit` コールバックから `saveSettings()` を呼ぶ（ドラッグ中の `onchange` では呼ばない。ディスクI/Oを抑えるため）

---

## 6. データフロー

```
ユーザーがハンドルをドラッグ
  → ResizeHandle: pointermove で onchange(newWidth) を都度呼ぶ
  → 呼び出し元（Sidebar/TOCPanel）が settingsStore.setSidebarWidth(newWidth) を呼ぶ
  → style width が再計算されリアルタイムに反映

ドラッグ終了（pointerup）
  → ResizeHandle: oncommit(finalWidth) を呼ぶ
  → 呼び出し元が saveSettings() を呼び、settings.json に永続化
```

---

## 7. 残課題

なし。設計フェーズ完了。
