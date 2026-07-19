# アクセシビリティ改善 技術設計

## ステータス

完了

## 構成

### `actions/focus-trap.ts`

Svelte actionとして実装する。マウント時の`document.activeElement`を記憶し、ダイアログ内の最初のフォーカス可能要素へ移動する。keydownでEscapeとTab循環を処理し、destroy時に記憶した要素がDOMへ残っていればフォーカスを戻す。

対象要素は有効なbutton、input、select、textarea、link、明示的なtabindexとする。操作要素がない場合はダイアログ自体へフォーカスする。

### モーダル

設定画面は内側パネル、ライトボックスは全画面コンテナをdialogとする。Escape処理はfocus-trapへ集約し、ライトボックスのwindowリスナーは削除する。

### `ResizeHandle.svelte`

既存`resizeDrag` actionはポインター操作専用のまま維持し、コンポーネントでkeydownを処理する。値をclampして`onchange`と`oncommit`を同時に呼ぶ。利用側から翻訳済みの`label`を渡す。

## テスト

- focus-trapの初期フォーカス、Tab循環、Escape、復帰。
- リサイズキー計算は純粋関数化し、方向・Shift・Home / End・clampをテストする。
- 実WebViewで設定画面とリサイズハンドルを操作する。
