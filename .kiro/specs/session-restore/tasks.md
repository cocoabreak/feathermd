# 実装タスク: タブ状態の永続化・復元 (session-restore)

> **2026-07-19更新**: 初期タスクに記載された `activePath` / `rootPath` 形式は正式リリース前に廃止した。現行形式と追加タスクは `../session-restore-enhancement/` を参照。

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: 実装

### T-001: タブ永続化モジュールの新規作成

- **概要**: `src/lib/tabs-store.ts`（`loadTabs()` / `saveTabs()`）を新規作成
- **チェックリスト**:
  - [x] `tabs.json`へ`{ tabs: {path, pinned}[], activePath }`を保存する`saveTabs()`
  - [x] 保存済みタブを順に`read_file`し、成功したものだけ`contentStore`/`tabStore`へ反映・`watch_path`する`loadTabs()`
  - [x] `read_file`失敗時はそのタブを黙ってスキップ
  - [x] `watch_path`失敗時はタブ自体は残したまま無視
- **対応US**: US-001, US-002

### T-002: `+page.svelte`への統合

- **依存**: T-001
- **概要**: 起動時の復元・自動保存の配線
- **チェックリスト**:
  - [x] `onMount`の`Promise.all`に`loadTabs()`を追加
  - [x] `hydrated`フラグを追加し、復元完了前の空状態保存を防ぐ
  - [x] `tabStore.tabs`/`activeTabId`を監視する`$effect`で`saveTabs()`を呼ぶ
- **対応US**: US-001, US-002

---

## Phase 2: 検証

### T-003: 動作確認

- **依存**: T-002
- **概要**: 実機での保存・復元確認
- **チェックリスト**:
  - [x] `npm run test`が通る（既存タブ関連テストに回帰なし、54件pass）
  - [x] 複数タブ（ピン留め含む）を開いた状態でリロード/再起動し、同じタブ構成・アクティブタブが復元されることを確認（CDPドライバー+スクリーンショットで実機確認）
  - [x] 保存されたタブのファイルを外部で削除してから起動し、該当タブが黙ってスキップされることを確認（tabs.jsonに存在しないパスを注入して検証）
  - [x] タブを1つも開いていない状態でのアプリ起動・終了に回帰がないことを確認（既存の`recent.json`と同じ`?? []`パターンのため安全）
- **対応US**: US-001, US-002

---

## Phase 3: リロード/再起動の区別・復元確認トースト・フォルダー復元

常時自動復元は過剰との判断から、リロードは自動復元を維持しつつアプリ再起動時のみ確認トーストを挟む方式に変更。あわせて、エクスプローラーのルートフォルダーが復元対象から漏れていた点も対応。

### T-004: Rust側でリロード/アプリ再起動を判定する`is_fresh_launch`コマンド

- **概要**: `src-tauri/src/commands/launch.rs`（新規）に`LaunchState(AtomicBool)`と`is_fresh_launch`コマンドを追加
- **チェックリスト**:
  - [x] プロセス内で最初の呼び出しのみ`true`を返す（`AtomicBool::swap`）
  - [x] `lib.rs`で`.manage(LaunchState::new())`し、`invoke_handler`に登録
  - [x] ユニットテストで「初回のみtrue」を確認
- **対応US**: US-002, US-003

### T-005: `tabs-store.ts`の分割・復元確認トースト・フォルダー復元対応

- **依存**: T-004
- **概要**: `loadTabs()`を`restoreSavedTabs()`/`loadTabsOnStartup()`に分割し、`discardSavedTabs()`を追加。ルートフォルダーパスも`tabs.json`に保存・復元する
- **チェックリスト**:
  - [x] `loadTabsOnStartup()`: `is_fresh_launch`が`false`（リロード）なら`restoreSavedTabs()`を即座に呼ぶ
  - [x] `loadTabsOnStartup()`: `true`（アプリ再起動）なら自動復元せず、保存済みタブ/ルートフォルダーの有無（`promptRestore`）を返す
  - [x] `discardSavedTabs()`: `tabs`/`activePath`/`rootPath`を空にして即保存
  - [x] `saveTabs()`/`restoreSavedTabs()`に`rootPath`（`explorerStore.rootPath`）を追加し、`openFolder()`で復元
  - [x] `SessionRestoreToast.svelte` + `session-restore-prompt.svelte.ts`: 「復元する」「破棄する」の2択トースト
  - [x] `+page.svelte`: トースト表示中・復元完了前は自動保存`$effect`を止める（`hydrated` / `sessionRestorePromptStore.visible`ガード）。`$effect`の監視対象に`explorerStore.rootPath`を追加
- **対応US**: US-002, US-003

### T-006: 動作確認（リロード/再起動の区別・トースト・フォルダー復元）

- **依存**: T-005
- **概要**: 実機での再確認
- **チェックリスト**:
  - [x] `npm run test`（54件pass）・`cargo test`（新規`launch`テスト含め16件pass）・`cargo clippy`・`npm run lint`/`check`に回帰なし
  - [x] リロード（`location.reload()`相当）: トーストなしで即座にタブ・フォルダーが復元される
  - [x] 完全終了→再起動: 空状態＋トースト表示、「復元する」でタブ・フォルダーが復元される
  - [x] 完全終了→再起動: 「破棄する」で空状態のまま、次回起動時もトーストが出ない（`tabs.json`が空になったことを確認）
  - [x] トースト表示中に新規でファイル/フォルダーを開いても、保存済みセッション情報が上書きされない
- **対応US**: US-002, US-003
