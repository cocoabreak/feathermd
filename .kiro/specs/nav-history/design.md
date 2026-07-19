# 技術設計: ナビゲーション履歴（戻る/進む）

## ステータス

完了

## 全体アーキテクチャ

既存の「runesストア + コマンドレジストリ + keymap」構成にそのまま乗せる。新規Rustコードは不要。

```
記録:   +page.svelte の $effect がアクティブタブのパス変化を検知 → historyStore.record(path)
        （タブ操作・リンク・エクスプローラー等、手段を問わず一元的に捕捉。tabs.json自動保存と同じ発想）

操作:   Alt+←/→        → keymap → nav.back / nav.forward コマンド
        マウスXButton1/2 → +page.svelte のmouseupリスナー → 同コマンド
        ↓
        navigateHistory(direction)（actions/history-actions.ts）
        タブが開いていれば setActive、閉じていれば openMarkdownFile で再オープン、
        開けなければエントリ除去して同方向へ続行
```

## 履歴ストア（`stores/history.svelte.ts`）

ブラウザ同様の「単一リスト + カーソル」モデル。

```ts
entries: string[]   // ファイルパスのリスト（古い→新しい）
index: number       // 現在位置（-1 = 空）
```

- `record(path)`: `entries[index] === path` なら無視（連続重複の排除）。それ以外は
  `index` より先を切り捨てて末尾に追加（戻った状態から新規オープン→進む履歴破棄）。
  上限 `MAX_ENTRIES = 50` を超えたら先頭から捨てる
- `step(direction)`: 範囲内なら `index` を移動して移動先パスを返す。範囲外なら `null`
- `dropCurrent(direction)`: 開けなかった現在エントリを除去し、`index` を移動元の位置へ戻す
  （次の `step(direction)` が同方向の次エントリを指すようにする）

### 記録と戻る/進むの相互作用（フラグ不要の設計）

戻る/進むで表示ファイルが変わると記録用 `$effect` も発火するが、その時点で
`entries[index]` は移動先パスと一致しているため `record` の連続重複チェックで自然に無視される。
「ナビゲーション中は記録を抑止するフラグ」は不要（Svelteのeffectは非同期バッチのため、
同期的なフラグON/OFFでは発火タイミングと合わずバグの温床になる。この設計で回避）。

**注意（実装時に顕在化したバグ）**: `record()` は内部で履歴の `entries`/`index` を読むため、
effect内で素朴に呼ぶとそれらがeffect自身の依存になり、`step()` によるindex変化で
effectが再発火して重複記録される。`untrack(() => historyStore.record(path))` で
「タブ状態の変化のみを依存にする」こと（MarkdownViewerのpostRenderContextと同じパターン）。

## 操作系

- **コマンド**: `nav.back` / `nav.forward` を `builtin.ts` に登録
- **keymap**: `Alt+ArrowLeft` / `Alt+ArrowRight`（`comboFromEvent` はAlt修飾対応済み）
- **マウス**: `+page.svelte` の `$effect` で `window` の `mouseup` を監視。
  `e.button === 3`（XButton1）→ back、`e.button === 4`（XButton2）→ forward。
  `preventDefault()` でWebView2既定のナビゲーションを抑止する

## エラー処理

`navigateHistory` は移動先が開けない（削除済み・信頼範囲外等）場合、
`dropCurrent` でエントリを履歴から除去し、同方向の次エントリを試すループ。
エラーダイアログは出さない（履歴は「戻れたら便利」な補助機能であり、失敗を騒がない）。

## 代替案の比較

| 案 | 判断 |
|---|---|
| $effectによる一元記録 | **採用**。tabs.json自動保存と同じパターンで、記録漏れが構造的に起きない |
| openMarkdownFile / setActive 等の各操作箇所で明示記録 | 不採用。呼び忘れが起きやすく、タブクリック等の経路を個別に塞ぐ必要がある |
| タブごとの独立履歴（ペイン単位） | 不採用。本アプリのリンク遷移は「タブ追加/アクティブ化」でありタブ内遷移ではないため、グローバル1本が実態に合う |
| 履歴の永続化 | 見送り。セッション復元（タブのみ）との整合を考える必要があり、v1では過剰 |
