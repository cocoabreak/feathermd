# 実装タスク: タブのピン留め (tab-pin)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

---

## Phase 1: 状態管理

### T-001: Tab型・tabStoreの変更 ✅

- **依存**: なし
- **概要**: `Tab`に`pinned`フラグを追加し、`tabStore`に`togglePin()`を追加、`close`/`closeAndUnwatch`にピン留めガードを入れる
- **完了条件**:
  - [x] `Tab`型に`pinned?: boolean`が追加されている
  - [x] `tabStore.togglePin(id)`でピン留め状態がトグルされる
  - [x] ピン留め中のタブは`close(id)`を呼んでも配列から除去されない
  - [x] ピン留め中のタブは`closeAndUnwatch(id)`を呼んでも`unwatch_path`/`contentStore.delete`が実行されない
- **対応US**: US-001, US-002

---

## Phase 2: UI実装

### T-002: TabBar.svelteへのピンボタン追加 ✅

- **依存**: T-001
- **概要**: `@lucide/svelte`の`Pin`/`PinOff`を使ったピン留めトグルボタンを追加し、ピン留め中はクローズボタンを非表示にする
- **完了条件**:
  - [x] 各タブにピンボタンが表示され、クリックで`tabStore.togglePin`が呼ばれる
  - [x] 未ピン留め時は`Pin`アイコン（控えめな色）、ピン留め中は`PinOff`アイコン（強調色）が表示される
  - [x] ピン留め中はクローズボタン（✕）が表示されない
- **対応US**: US-001, US-002

---

## Phase 3: 品質確認

### T-003: 動作確認 ✅

- **依存**: Phase 2完了
- **概要**: 実アプリでピン留め・解除・クローズ防止の動作を確認する
- **完了条件**:
  - [x] タブをピン留めするとクローズボタンが消える
  - [x] ピン留め中のタブがアクティブな状態で`Ctrl+W`を押しても閉じられない
  - [x] ピン留めを解除するとクローズボタンが再表示され、通常通り閉じられる
  - [x] 他のタブ操作（切り替え・`Ctrl+Tab`等の`tab.next`/`tab.prev`・`Ctrl+数字`の`jumpTo`）に影響がない
  - [x] `npm run format` / `npm run lint` / `npm run check` / `npm run test` がエラーなく通る
- **対応US**: 全US
- **備考**: `/run-feathermd`スキル（CDP経由のドライバー）で実際にTauriウィンドウを起動し、2ファイルをタブで開いてピン留め→`Ctrl+W`阻止→解除→`Ctrl+W`でクローズ、までスクリーンショット付きで実測確認済み
