# 技術設計: サイドバー内の目次レイアウト改善 (toc-layout)

## ステータス

完了

> 2026-07-13: `.kiro/specs/responsive-toc-layout/` により、サイドバー内の上下分割は
> ワイド時の独立した右目次ペインと、狭幅時の目次ドロワーへ置き換える。

---

## 1. 概要

目次の高さ管理を「固定px（`tocHeight`）」から「サイドバーコンテンツ領域に占める比率（`tocRatio`）」へ変更する。リサイズハンドルはpxで動くため、Sidebar側でコンテナ高さを実測してpx⇔比率の変換を行う。目次が空のときはヘッダー行のみ表示に自動で畳む。

---

## 2. 未決定事項の確定

- **クランプ範囲**: `tocRatio` は 0.2〜0.8 でクランプする。極端な比率はどちらかのパネルが実用不能になるため
- **マイグレーション**: 保存済みの旧 `tocHeight`（px）は読み捨て、新デフォルト（0.7）を適用する。変換式を作るほどの価値がなく（設定し直せば済む）、KISSを優先

---

## 3. 設定（`stores/settings.svelte.ts` / `settings-store.ts`）

- `tocHeight: number` を廃止し `tocRatio: number` を追加（デフォルト `0.7` = 目次70%）
- 定数: `DEFAULT_TOC_RATIO = 0.7` / `MIN_TOC_RATIO = 0.2` / `MAX_TOC_RATIO = 0.8`。`DEFAULT_TOC_HEIGHT` / `MIN_TOC_HEIGHT` / `MAX_TOC_HEIGHT` は削除
- `setTocRatio(ratio)` はクランプして保存。`loadSettings` は旧キー `tocHeight` を無視し、`tocRatio` が数値ならクランプ適用

## 4. レイアウト（`Sidebar.svelte`）

- サイドバーのコンテンツ領域（タブヘッダーを除く `flex-1` 部分）の高さを `bind:clientHeight` で実測する
- 目次パネルの高さは `tocRatio × コンテンツ領域高さ` のpxで指定（現行のpx指定構造を維持し、変換のみ追加）
- `ResizeHandle` は現行どおりpxで動かし、`min` / `max` / `defaultSize` は比率×コンテナ高さで都度算出。`oncommit` でpx→比率に変換して `setTocRatio` に渡す
- ドラッグ中はローカルstateのみ更新する現行方式を踏襲（settingsStore即時反映による再レンダリング問題の回避。Sidebar.svelte内の既存コメント参照）

## 5. 空の目次の自動格納

- 判定: `tocStore` の見出しが0件（ファイル未オープン含む）
- 空のとき: 目次パネルはヘッダー行（「目次」+閉じるボタン）のみ表示し、リサイズハンドルも非表示。エクスプローラーが `flex-1` で残り全高を使う
- ヘッダー行を残す理由: 目次機能が有効であることを示し、「目次が消えた」という誤解を防ぐ
- `tocVisible` 設定（トグル）との関係: `tocVisible: false` なら従来どおりヘッダーごと非表示。自動格納は `tocVisible: true` かつ見出し0件のときのみ

## 6. 影響範囲

- `StatusBar.svelte.test.ts` 等の既存テストで `tocHeight` を参照しているものがあれば追従修正
- `panel-resize` spec（実装済み）のTOC高さ関連の記述と実態が変わるため、本specから置き換える旨を注記する
