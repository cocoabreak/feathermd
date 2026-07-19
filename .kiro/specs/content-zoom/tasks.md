# 実装タスク: コンテンツズーム (content-zoom)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: 状態管理

### T-001: settingsStoreへのcontentZoomプロパティ追加 ✅

- **依存**: なし
- **概要**: `Settings` 型に `contentZoom` を追加し、クランプ付きセッター・zoomIn/zoomOut/resetZoomを実装する
- **完了条件**:
  - [x] `Settings` 型に `contentZoom: number` が追加されている
  - [x] `setContentZoom` が `MIN_CONTENT_ZOOM`（50）〜`MAX_CONTENT_ZOOM`（200）でクランプする
  - [x] `zoomIn` / `zoomOut` が `CONTENT_ZOOM_STEP`（10）刻みで `setContentZoom` を呼ぶ
  - [x] `resetZoom` が `DEFAULT_CONTENT_ZOOM`（100）に戻す
  - [x] デフォルト値が `contentZoom: 100`
- **対応US**: US-001, US-002

### T-002: 永続化対応 ✅

- **依存**: T-001
- **概要**: `settings-store.ts` の `loadSettings` を更新し、保存済みズーム率を復元する
- **完了条件**:
  - [x] 保存済み `contentZoom`（number）があれば復元する
  - [x] 保存値がない初回起動時はデフォルト値（100）のまま
- **対応US**: US-003

---

## Phase 2: UI統合

### T-003: キーボードショートカット登録 ✅

- **依存**: T-001
- **概要**: `keymap.ts` にズーム関連のキーを追加し、`builtin.ts` にコマンドを登録する
- **完了条件**:
  - [x] `Ctrl+=` / `Ctrl++` / `Ctrl+Shift++` で `view.zoomIn` が発火する
  - [x] `Ctrl+-` で `view.zoomOut` が発火する
  - [x] `Ctrl+0` で `view.zoomReset` が発火する
  - [x] 各コマンド実行後に `saveSettings()` が呼ばれる
- **対応US**: US-001, US-003

### T-004: MarkdownViewer.svelteへの適用とホイールズーム ✅

- **依存**: T-001
- **概要**: コンテンツ領域に `font-size` を反映し、Ctrl+ホイールでのズームに対応する
- **完了条件**:
  - [x] `contentEl` の `style` に `font-size: {settingsStore.settings.contentZoom}%` が反映される
  - [x] `Ctrl+ホイール` でズームイン/アウトし、`e.preventDefault()` でブラウザ標準ズームを抑止する
  - [x] ホイール操作時の保存は300msデバウンスされる
  - [x] Toolbar・Sidebar・TOCPanel・StatusBar等UI本体の文字サイズは変わらない
- **対応US**: US-001

### T-005: StatusBarへのズーム率表示 ✅

- **依存**: T-001
- **概要**: `StatusBar.svelte` に現在のズーム率を表示し、クリックでリセットできるようにする
- **完了条件**:
  - [x] StatusBarに `{contentZoom}%` が表示される
  - [x] クリックで100%にリセットされ `saveSettings()` が呼ばれる
- **対応US**: US-002

---

## Phase 3: 品質確認

### T-006: 動作確認 ✅

- **依存**: Phase 2完了
- **概要**: 開発環境・実機での動作確認とコード品質チェック
- **完了条件**:
  - [x] キーボードショートカット・Ctrl+ホイールそれぞれでズームイン/アウト/リセットが正しく動作する
  - [x] 50%/200%の境界でクランプされ、それ以上変化しない
  - [x] StatusBarの表示がズーム操作に連動する
  - [x] アプリ再起動後、ズーム率が復元される（実機の`npm run tauri dev`で確認）
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: 全US
