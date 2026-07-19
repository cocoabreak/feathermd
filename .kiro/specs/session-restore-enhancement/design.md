# 技術設計: セッションUI状態の復元強化 (session-restore-enhancement)

## ステータス

完了

## 1. 方針

既存の `tabs.json` / `tabs-store.ts` をセッション状態の単一保存先として拡張する。正式リリース前のため旧開発版形式の移行・互換レイヤーは設けない。

スクロール状態は `session-ui-state.svelte.ts` に集約し、`MarkdownViewer` のローカルMapを置き換える。永続化時は各 `PersistedTab` に位置を格納し、復元時は保存配列のインデックスから新しいタブIDへ結び直す。

## 2. 保存形式

```ts
interface PersistedScrollPositions {
  rendered?: number;
  source?: number;
  safe?: number;
}

interface PersistedTab {
  path: string;
  pinned: boolean;
  source?: SourceSpec;
  documentPath?: string;
  scrollPositions?: PersistedScrollPositions;
}

interface PersistedSearchState {
  open: boolean;
  query: string;
  useRegex: boolean;
}

interface PersistedSession {
  tabs?: PersistedTab[];
  activeIndex?: number | null;
  explorer?: SourceSpec | null;
  expandedDirs?: string[];
  search?: PersistedSearchState;
}
```

検索結果・現在マッチはDOMから再計算できる派生状態なので保存しない。

## 3. スクロール位置

`sessionUiStateStore` は `Map<tabId, ScrollPositions>` を保持する。表示キーは `rendered | source | safe` とし、現在の `tabId:mode` 文字列キーを構造化する。

- `MarkdownViewer.handleScroll`: 現在位置をストアへ記録
- `MarkdownViewer.scheduleScrollRestore`: ストアから位置を取得
- `restoreSavedTabs`: 各タブ復元直後に保存時インデックスに対応する位置を新タブIDへ設定
- `saveTabs`: 現在のタブ順で各タブの位置を `PersistedTab` へ格納

保存値は有限かつ0以上の数だけ受理する。DOM描画後の `requestAnimationFrame` で `scrollTop` を設定する既存の競合回避処理は維持する。

## 4. Explorer展開状態

`explorer-actions.ts` に復元専用関数を追加する。保存済みパスを重複排除し、最大64件に制限したうえで、現在ロード済みツリーから見つかる親を順次展開する。各ラウンドで見つかったディレクトリの子を読み込み、見つからない子孫は次のラウンドへ送る。進捗がなくなれば終了する。復元全体で保持する子エントリは累積10,000件を上限とし、超過するディレクトリ以降は復元しない。

ユーザー操作用 `toggleDirectory` はアラートを表示するが、復元用関数は失敗を黙ってスキップする。復元完了後に `syncDirWatches()` を一度実行する。

## 5. 検索状態

`searchStore` に以下を追加する。

- `restoreSessionState({ open, query, useRegex })`: 保存対象だけを設定し、結果系状態を初期化
- `sessionState`: 保存可能な3項目のスナップショット

`restoreSavedTabs` の最後に検索状態を反映する。`MarkdownViewer` の既存effectが復元後のアクティブ文書に対して検索結果を再構築する。

## 6. 保存トリガーと復元順序

`+page.svelte` の既存 `$effect` に以下の依存を追加する。

- `explorerStore.expandedDirs`
- `searchStore.open/query/useRegex`
- `sessionUiStateStore.version`

実際のディスク書き込みは既存 `LatestSaveQueue` の200ms遅延に集約する。

通常の破棄時コールバックは完了を待てないため、`Ctrl+R` / `Cmd+R` / `F5` はグローバルkeydownで既定動作を停止する。`saveAndFlushTabs()`・`flushRecent()`・`flushSettings()`を待ってから `location.reload()` を呼び、最後の200ms窓に入ったスクロールや検索変更も欠落させない。同じ処理の多重実行はフラグで抑止する。

復元順序は次のとおり。

1. Explorerルートを開く
2. タブを復元し、各タブへスクロール位置を結び直す
3. アクティブタブを復元
4. Explorerの展開状態を親から復元
5. 検索状態を反映し、DOMから結果を再計算

## 7. セキュリティ・堅牢性

- スクロール位置は有限かつ0以上の値だけ採用
- Explorer展開パスは文字列だけを採用し、重複排除後も最大64件。読み込む子エントリは累積10,000件
- Rust側でも `expandedDirs` の型・64件上限と検索状態の型・検索語長を検証
- Rust側の状態スキーマは現行キーだけを許可し、旧 `activePath` / `rootPath` を未知キーとして拒否する
- 現在のExplorerツリーに存在するディレクトリだけを読み込むため、保存値を直接ファイルシステムAPIへ渡さない
- 読み込み失敗は当該パスだけをスキップする
