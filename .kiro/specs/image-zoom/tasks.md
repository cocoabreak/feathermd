# 実装タスク: 画像・Mermaidズーム (image-zoom)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: 状態管理

### T-001: lightbox.svelte.ts の実装 ✅

- **依存**: なし
- **概要**: `app/src/lib/stores/lightbox.svelte.ts` を新規作成する
- **完了条件**:
  - [x] `open` / `content` のgetterがある
  - [x] `openImage(src, alt)` / `openSvg(html)` / `close()` が実装されている
- **対応US**: US-001

---

## Phase 2: UI実装

### T-002: Lightbox.svelte の実装 ✅

- **依存**: T-001
- **概要**: `app/src/lib/components/Lightbox.svelte` を新規作成する
- **完了条件**:
  - [x] 外側は半透明スクリム（元コンテンツがうっすら透ける）、内側は画面の75%サイズ・常に不透明なステージの2層構成になっている
  - [x] 画像/SVGはステージ内に収まるサイズで初期表示され、ズームしてもステージ外にははみ出さない（overflow-hidden）
  - [x] マウスホイールでズームイン/アウトし、下限25%でクランプされる（上限なし）
  - [x] ステージ内どこでもドラッグでパンできる
  - [x] ダブルクリックで初期表示にリセットされる
  - [x] Escape・外側スクリムのクリック・✕ボタンのいずれでも閉じる
  - [x] ステージ内側（画像/図・余白含む）のクリックでは閉じない
- **対応US**: US-001, US-002, US-003

### T-003: MarkdownViewer.svelteへのクリック検知追加 ✅（T-006で置き換え）

- **依存**: T-001
- **概要**: `handleClick` に画像/Mermaid SVGのクリック検知を追加する
- **完了条件**:
  - [x] 本文中の `<img>` クリックで `lightboxStore.openImage` が呼ばれる
  - [x] Mermaidでレンダリングされた `<svg>` クリックで `lightboxStore.openSvg` が呼ばれる
  - [x] リンクで囲まれた画像をクリックした場合、リンク遷移ではなくライトボックスが開く
  - [x] 画像/Mermaid図以外のリンククリックは既存の動作のまま変化がない
- **対応US**: US-001

### T-004: +page.svelteへのマウント ✅

- **依存**: T-002
- **概要**: `Lightbox` をグローバルに1箇所マウントする
- **完了条件**:
  - [x] `{#if lightboxStore.open}<Lightbox />{/if}` が追加されている
- **対応US**: US-001

---

## Phase 4: 起動トリガーの変更（2026-07-03改訂）

### T-006: image-lightbox-trigger.ts の新規作成 ✅

- **依存**: T-001
- **概要**: `setupImageLightboxTrigger`（画像用）・`addMermaidExpandButton`（Mermaid用）を実装する
- **完了条件**:
  - [x] 各 `img` が `.lightbox-trigger-wrapper`（`inline-block`）で包まれ、展開アイコンが追加される
  - [x] アイコンクリックで `lightboxStore.openImage(img.src, img.alt)` が呼ばれる
  - [x] `addMermaidExpandButton(el)` が `.mermaid-rendered` に展開アイコンを追加し、クリックで `lightboxStore.openSvg(svg.outerHTML)` が呼ばれる
  - [x] アイコンクリック時、`preventDefault`/`stopPropagation` によりリンクへの遷移が発生しない
- **対応US**: US-001

### T-007: MarkdownViewer.svelte / mermaid-post.ts への組み込み ✅

- **依存**: T-006
- **概要**: `handleClick` から画像/Mermaid SVGの早期returnを削除し、`setupImageLightboxTrigger` / `addMermaidExpandButton` の呼び出しを組み込む
- **完了条件**:
  - [x] `handleClick` に画像/Mermaid SVGの早期returnが残っていない
  - [x] コンテンツ再レンダリング時に `setupImageLightboxTrigger(contentEl)` が呼ばれる
  - [x] `mermaid-post.ts`の`renderOne()`で `mermaid-rendered` に切り替わった直後に `addMermaidExpandButton(el)` が呼ばれる（画面外にあった図が遅延レンダリングされた場合も含む）
  - [x] 展開アイコン用CSS（ホバー表示・画像/Mermaidそれぞれの位置調整）が追加されている
- **対応US**: US-001

### T-008: 動作確認（改訂分） ✅

- **依存**: T-007
- **概要**: バッジ画像の横並び表示・通常画像・Mermaid図それぞれで新トリガーの動作を確認する
- **完了条件**:
  - [x] バッジ画像（横並びの小さい画像群）のホバーでアイコンが表示されても、画像自体の横並び表示（display:inline）が崩れない（実CSS+実DOM構造でのヘッドレスブラウザ実測: top座標が揃うことを確認）
  - [x] 通常の画像・Mermaid図それぞれでホバー時にアイコンが表示され、クリックでライトボックスが開く（openImage/openSvgの呼び出しを実測確認）
  - [x] リンクで囲まれた画像で、画像本体クリックはリンク遷移し、アイコンクリックはライトボックスが開く（stopPropagationによりアンカーのclickが発火しないことを実測確認）
  - [x] 画面外にあり遅延レンダリングされたMermaid図でもアイコンが表示される（`renderOne()`内で個別に`addMermaidExpandButton`を呼ぶ設計のため、レンダリングされた時点で確実に追加される）
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: US-001

---

## Phase 3: 品質確認

### T-005: 動作確認 ✅

- **依存**: Phase 2完了
- **概要**: 開発環境・実機での動作確認とコード品質チェック
- **完了条件**:
  - [x] 通常の画像クリックでライトボックスが開き、画面フィット表示になる
  - [x] Mermaid図クリックでライトボックスが開く
  - [x] リンクで囲まれた画像でリンク遷移が発生せずライトボックスが開く
  - [x] ホイールズーム・ドラッグパン・ダブルクリックリセットが正しく動作する
  - [x] Escape・背景クリック・✕ボタンで閉じる
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: 全US
