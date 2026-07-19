# 実装タスク: ナビゲーション履歴（戻る/進む）

## Phase 1: 履歴ストア

- [x] 1.1 `stores/history.svelte.ts` — entries/index、record（連続重複排除・進む履歴破棄・上限50）、step、dropCurrent
- [x] 1.2 `stores/history.svelte.test.ts` — record/step/dropCurrent のユニットテスト（10ケース）

## Phase 2: 操作系

- [x] 2.1 `actions/history-actions.ts` — navigateHistory（既存タブ活性化 / 再オープン / 開けなければ除去して続行）
- [x] 2.2 `commands/builtin.ts` — nav.back / nav.forward 登録
- [x] 2.3 `commands/keymap.ts` — Alt+ArrowLeft / Alt+ArrowRight
- [x] 2.4 `+page.svelte` — アクティブパス記録の$effect（`untrack`必須、design.md参照）、マウスXButton1/2のmouseupリスナー

## Phase 3: 検証

- [x] 3.1 ユニットテスト（vitest）全パス（89件）
- [x] 3.2 format / lint / check（警告は既存のMarkdownViewer a11yのみ）
- [x] 3.3 実機確認: 手段を問わない記録、Alt+←/→、マウスボタン（button 3/4）、端での無反応、進む履歴の保持、閉じタブ再オープン、戻った状態からの新規オープンで進む履歴破棄、削除済みファイルのスキップ&履歴除去
