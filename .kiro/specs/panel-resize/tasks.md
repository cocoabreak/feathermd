# 実装タスク: パネルリサイズ (panel-resize)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: 状態管理

### T-001: settingsStoreへの幅プロパティ追加 ✅

- **依存**: なし
- **概要**: `Settings` 型に `sidebarWidth` / `tocWidth` を追加し、クランプ付きセッターを実装する
- **完了条件**:
  - [x] `Settings` 型に `sidebarWidth: number` / `tocWidth: number` が追加されている
  - [x] `setSidebarWidth` / `setTocWidth` が `MIN_PANEL_WIDTH`（160）〜`MAX_PANEL_WIDTH`（480）でクランプする
  - [x] デフォルト値が `sidebarWidth: 224` / `tocWidth: 208`
- **対応US**: US-001, US-002, US-003

### T-002: 永続化対応 ✅

- **依存**: T-001
- **概要**: `settings-store.ts` の `loadSettings` を更新し、保存済み幅を復元する
- **完了条件**:
  - [x] 保存済み `sidebarWidth` / `tocWidth`（number）があれば復元する
  - [x] 保存値がない初回起動時はデフォルト値のまま
- **対応US**: US-003

---

## Phase 2: UIコンポーネント

### T-003: ResizeHandleコンポーネント実装 ✅

- **依存**: なし
- **概要**: `app/src/lib/components/ResizeHandle.svelte` を新規実装する
- **完了条件**:
  - [x] `pointerdown` → `pointermove` → `pointerup` でドラッグリサイズできる
  - [x] `min` / `max` でクランプされる
  - [x] ダブルクリックで `defaultWidth` にリセットされる
  - [x] 通常時は透明、hover時のみハンドルが視覚的に強調される
- **対応US**: US-001, US-002

### T-004: Sidebarへの適用 ✅

- **依存**: T-001, T-003
- **概要**: `Sidebar.svelte` の固定幅クラスを廃止し `ResizeHandle` を組み込む
- **完了条件**:
  - [x] Sidebar幅が `settingsStore.settings.sidebarWidth` に連動する
  - [x] 右端のハンドルドラッグで幅がリアルタイムに変わる
  - [x] ドラッグ終了（`oncommit`）時に `saveSettings()` が呼ばれる
  - [x] Sidebar非表示時はハンドルも表示されない
- **対応US**: US-001, US-003

### T-005: TOCPanelへの適用 ✅

- **依存**: T-001, T-003
- **概要**: `TOCPanel.svelte` の固定幅クラスを廃止し `ResizeHandle` を組み込む
- **完了条件**:
  - [x] TOC幅が `settingsStore.settings.tocWidth` に連動する
  - [x] 左端のハンドルドラッグで幅がリアルタイムに変わる
  - [x] ドラッグ終了時に `saveSettings()` が呼ばれる
  - [x] TOCPanel非表示時はハンドルも表示されない
- **対応US**: US-002, US-003

---

## Phase 3: 品質確認

### T-006: 動作確認

- **依存**: Phase 2完了
- **概要**: 開発環境での動作確認とコード品質チェック
- **完了条件**:
  - [x] Sidebar・TOCPanel双方のリサイズが滑らかに動作する（Vite開発サーバー+ヘッドレスブラウザで、ドラッグ・最小/最大クランプ・ダブルクリックリセットを確認）
  - [x] アプリ再起動後にリサイズ幅が復元される（実機の `npm run tauri dev` で確認。当初、Sidebar/TOCPanelのローカル幅stateがマウント時の一度きりの初期値コピーで、非同期`loadSettings()`完了後の値に追従しないバグがあり修正済み）
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: 全US
