# 技術設計: レスポンシブ目次レイアウト (responsive-toc-layout)

## ステータス

完了

## 1. コンポーネント構成

- `Sidebar.svelte`: エクスプローラー／検索だけを担当し、目次の上下分割責務を削除する
- `TocPanel.svelte`: ワイド時の右ペイン、狭幅時の起動ボタンとドロワーを一元管理する
- `TOCView.svelte`: 任意の `onselect` コールバックを受け、ドロワーでは見出し選択後に閉じる
- `+page.svelte`: `matchMedia` で1000px境界を監視し、`TocPanel`へ表示形式を渡す

## 2. 状態と設定

- `settingsStore.settings.tocVisible`: ユーザーが目次機能を表示するかという永続設定
- `settingsStore.settings.tocWidth`: ワイド時の目次ペイン幅。既存設定を再利用する
- ドロワーの開閉: `TocPanel`内の一時状態。永続化しない
- ブレークポイント切替で `tocVisible` を変更しない
- 目次を有効化しても `sidebarVisible` やサイドバーのアクティブタブを変更しない
- 旧 `tocRatio` は互換性のため設定に残すが、新レイアウトでは使用しない

## 3. レスポンシブ表示

- `matchMedia("(max-width: 999px)")` がfalse: 右ペイン＋左リサイズハンドル
- true: 右ペインを描画せず、見出しがある場合のみコンテンツ右上へ起動ボタンを配置
- 狭幅からワイドへ戻る、目次無効化、見出しが空になる、のいずれかでドロワーを閉じる

## 4. ドロワーとアクセシビリティ

- 作業領域を `position: relative` とし、ドロワーとスクリムをabsolute配置してタイトルバー／ステータスバーを覆わない
- ドロワーは `role="dialog"`、`aria-modal="true"`、見出しによるラベルを持つ
- 既存の `focusTrap` actionで初期フォーカス、Tab循環、Esc、フォーカス復帰を処理する
- スクリムクリック、閉じるボタン、目次項目選択でも閉じる
- 起動ボタンは `aria-expanded` と `aria-controls` を持つ

## 5. リサイズ

- 既存の `ResizeHandle` を `edge="left"` で利用する
- ドラッグ中はローカル幅だけを更新し、終了時に `setTocWidth` と `saveSettings` を呼ぶ
- 最小160px、最大480px、デフォルト208pxは既存定数を継続利用する
