# 技術設計: UI細部改善（フォルダを閉じる・履歴削除・目次リサイズ） (ui-refinements)

## ステータス

完了

---

## 1. 概要

独立した3つの小改修。いずれも既存の仕組み（メニューID→コマンドルーティング、recentStore＋recent.json、tocRatio＋ResizeHandle）への追加であり、新しいアーキテクチャ要素は導入しない。

---

## 2. 未決定事項の確定

- **ドラッグロジックの共通化**: `ResizeHandle.svelte` 内のポインタ処理をSvelteアクション `actions/resize-drag.ts` へ抽出し、`ResizeHandle`（従来の細いハンドル）と目次ヘッダーバーの両方が同じアクションを使う。コンポーネントを汎用化（スロット化・クラス注入）するよりKISS
- **サイドバー空状態の判定**: `explorerStore.rootPath === null` に変更する。現行の `tree.length === 0` では「空フォルダを開いた状態」でも最近開いたフォルダー一覧が表示され、「フォルダを閉じた状態」と区別できないため

---

## 3. フォルダを閉じる（US-001）

### メニュー（`src-tauri/src/menu.rs`）

- ファイルメニューの「フォルダを開く...」直後に「フォルダを閉じる」を追加。ID: `file.closeFolder`、ラベルはja/en両辞書に追加。アクセラレータなし
- 既存の `menu-action` emit → フロントの `runCommand` ルーティングに乗るため、Rust側はメニュー項目の追加のみ

### フロントエンド

- `stores/explorer.svelte.ts`: `clear()` を追加（`rootPath = null`、ツリー・展開・読み込み状態を初期化）
- `actions/explorer-actions.ts`: `closeFolder()` を追加。`explorerStore.clear()` → `syncDirWatches()`（表示中ディレクトリが無くなるため全監視が解除される）
- `commands/builtin.ts`: `file.closeFolder` → `closeFolder()` を登録
- セッション保存: `+page.svelte` の自動保存effectが `explorerStore.rootPath` を監視済みのため、追加実装なしで `rootPath: null` が保存される
- `Sidebar.svelte`: 空状態判定を `explorerStore.rootPath === null` に変更

## 4. 履歴の個別削除（US-002）

- `stores/recent.svelte.ts`: `removeFile(path)` / `removeFolder(path)` を追加（該当パスをフィルタ除去）。ユニットテストも追加
- UI（`Sidebar.svelte` の最近開いたフォルダー / `MarkdownViewer.svelte` の最近開いたファイル）:
  - 各 `<li>` を `relative group` にし、項目ボタンの左に削除ボタンを絶対配置
  - 削除ボタンは lucide `X` アイコン。非ホバー時 `opacity-0`、行ホバー時 `group-hover:opacity-100`
  - 項目ボタン側は左パディングを常時確保し（アイコンと重ならない幅）、ホバー時のテキストずれを起こさない
  - 削除クリックで `remove*()` → `saveRecent()`。項目オープンとは独立したボタンなので誤オープンは構造上起きない
- i18n: `common.removeFromHistory`（ja: 履歴から削除 / en: Remove from History）を追加し、削除ボタンの `title` に使う

## 5. 目次ヘッダーバーでのリサイズ（US-003）

### `actions/resize-drag.ts`（新規）

- Svelteアクション。パラメータ: `edge` / `size` / `min` / `max` / `defaultSize` / `enabled` / `onchange` / `oncommit` / `ondragchange`（ドラッグ状態通知、ハンドルのハイライト用）
- 挙動は現行 `ResizeHandle` と同一: pointerdownでキャプチャ、moveで `movement` 差分をクランプして `onchange`、upで `oncommit`、ダブルクリックで `defaultSize` に戻す
- 追加仕様:
  - `enabled: false` のときドラッグ・ダブルクリックとも無効（目次が空のとき用）
  - pointerdown対象が `button` 内のときはドラッグを開始しない（✕ボタン保護）
- パラメータはリアクティブに更新される（Svelte 5の `use:` はパラメータ変更で `update` が呼ばれる）

### 利用側

- `ResizeHandle.svelte`: 内部のポインタ処理を削除し `use:resizeDrag` に置き換え（見た目・propsは不変）
- `Sidebar.svelte`: 目次ヘッダーバーに `use:resizeDrag`（`edge: "top"`、pxと比率の変換は既存の上端ハンドルと同じ式）と `cursor-row-resize` を付与。`enabled` は「目次が空でなくコンテンツ領域高さが実測済み」のとき

## 6. 影響範囲

- `recent-files` spec: スコープの「対象外: 一覧からの個別削除」に本specで実現した旨を注記
- `ResizeHandle` を使う他の箇所（サイドバー幅）はprops不変のため影響なし
