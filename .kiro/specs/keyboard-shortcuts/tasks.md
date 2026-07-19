# 実装タスク: キーボードショートカット (keyboard-shortcuts)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: コマンド基盤

### T-001: コマンドレジストリの実装 ✅

- **依存**: なし
- **概要**: `app/src/lib/commands/registry.ts` を新規実装する
- **完了条件**:
  - [x] `registerCommand` / `runCommand` が実装されている
  - [x] 未登録idに対する `runCommand` が例外を投げず安全に無視される（`commands.get(id)?.run()` によりOptional chainingで安全）
- **対応US**: —

### T-002: キーマップとコンボ文字列化の実装 ✅

- **依存**: なし
- **概要**: `app/src/lib/commands/keymap.ts` を新規実装する（`comboFromEvent` と `keymap` テーブル）
- **完了条件**:
  - [x] `Ctrl` / `Shift` / `Alt` の組み合わせが `"Ctrl+Shift+Tab"` のように正しく文字列化される
  - [x] `Escape` が単独コンボとして扱われる
  - [x] 修飾キー単体の `keydown`（`Control` / `Shift` / `Alt` / `Meta` キー自体）は `null` を返す
  - [x] design.md §3 のキーマップ一覧が定義されている
- **対応US**: US-001〜US-004

---

## Phase 2: 既存ロジックの一本化（リファクタリング）

### T-003: dialog-actions.tsへの切り出し ✅

- **依存**: なし
- **概要**: `Toolbar.svelte` の `handleOpenFile` / `handleOpenDirectory` を `app/src/lib/actions/dialog-actions.ts` に `openFileDialog` / `openFolderDialog` として切り出す
- **完了条件**:
  - [x] `openFileDialog` / `openFolderDialog` が実装されている
  - [x] `Toolbar.svelte` は切り出した関数を呼ぶだけになっている
  - [x] 既存の動作（ファイル/フォルダを開くダイアログ、エラー時のalert表示）に変化がない
- **対応US**: US-001

### T-004: tabStoreへのcycle/jumpTo/closeAndUnwatch追加 ✅

- **依存**: なし
- **概要**: `tab.svelte.ts` に `cycle` / `jumpTo` / `closeAndUnwatch` を追加し、`TabBar.svelte` の `closeTab` を置き換える
- **完了条件**:
  - [x] `cycle(1)` / `cycle(-1)` でタブが先頭/末尾をまたいでループ切り替えする
  - [x] `jumpTo(index)` は該当タブがなければ何もしない
  - [x] `closeAndUnwatch(id)` が `unwatch_path` 呼び出し・`close`・`contentStore.delete` を行う
  - [x] `TabBar.svelte` の閉じるボタンが `closeAndUnwatch` を使うよう更新されている
  - [x] タブが0件の状態で `cycle` / `jumpTo` を呼んでもエラーにならない（早期returnで対応）
- **対応US**: US-002

### T-005: uiStoreの新規作成と+page.svelte統合 ✅

- **依存**: なし
- **概要**: `app/src/lib/stores/ui.svelte.ts` を新規作成し、`+page.svelte` の `settingsOpen` ローカル状態を置き換える
- **完了条件**:
  - [x] `uiStore.settingsPanelOpen` / `openSettings()` / `closeSettings()` が実装されている
  - [x] `+page.svelte` と `SettingsPanel` 呼び出し箇所が `uiStore` を参照するよう更新されている
  - [x] 設定パネルの開閉の見た目・動作が変わらない
- **対応US**: US-004

---

## Phase 3: コマンド登録とキーバインド統合

### T-006: builtin.tsでのコマンド登録 ✅

- **依存**: T-001, T-003, T-004, T-005
- **概要**: `app/src/lib/commands/builtin.ts` を新規作成し、全コマンドを登録する
- **完了条件**:
  - [x] `file.open` / `file.openFolder` / `tab.close` / `tab.next` / `tab.prev` / `tab.jumpTo:0`〜`tab.jumpTo:8` / `panel.toggleSidebar` / `panel.toggleToc` / `settings.open` / `settings.close` が登録されている
- **対応US**: US-001〜US-004

### T-007: グローバルkeydownリスナーの実装 ✅

- **依存**: T-002, T-006
- **概要**: `+page.svelte` にキーボードイベントリスナーを追加する
- **完了条件**:
  - [x] `builtin.ts` が起動時に一度だけimportされ、コマンドが登録される
  - [x] `keymap` で定義された全ショートカットが動作する（実機`npm run tauri dev`で確認）
  - [x] `input` / `textarea` / `[contenteditable="true"]` にフォーカスがある場合は発火しない
  - [x] 一致したショートカットは `event.preventDefault()` される
- **対応US**: US-001〜US-004

---

## Phase 4: 品質確認

### T-008: 動作確認 ✅

- **依存**: Phase 3完了
- **概要**: 開発環境での動作確認とコード品質チェック
- **完了条件**:
  - [x] design.md §3 の全ショートカットが期待通り動作する（実機`npm run tauri dev`で確認）
  - [x] Toolbarのボタン操作・TabBarの閉じるボタン操作が従来どおり動作する（リグレッションなし）
  - [x] `npm run format` / `npm run lint` / `npm run check` がエラーなく通る
- **対応US**: 全US
