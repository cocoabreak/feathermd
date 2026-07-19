# 技術設計: UIドラッグ挙動の改善 (ui-drag-behavior)

## ステータス

完了

## 1. リサイズハンドル

- `ResizeHandle.svelte`のリングを`focus:*`から`focus-visible:*`へ変更する。ポインター操作で要素自体がフォーカスされても太線を残さず、キーボードフォーカス時の視認性は維持する。
- `resize-drag.ts`は`lostpointercapture`でも既存の終了処理を呼ぶ。`pointerup`と続けて発生しても、`dragging`ガードにより`oncommit`を重複実行しない。
- ドラッグ開始は主ポインターの左ボタンに限定する。既存のbutton除外、サイズclamp、ダブルクリックリセットは維持する。
- `ResizeHandle`の使用箇所はSidebar右端と目次左端の2箇所で、共通実装の変更により双方へ適用する。

## 2. 文字選択

- `app.css`で`body`を`user-select: none`とし、アプリUI全体を既定で選択不可にする。
- `.markdown-body`のうち、実文書があり読み込み中ではない場合だけ`selectable-content`クラスを付け、`user-select: text`へ戻す。レンダリング表示だけでなく、その内側へ配置されるソース表示・セーフモード本文も選択可能になる。
- ウェルカム・読み込み表示も`.markdown-body`をレイアウト契約として共有するが、`selectable-content`は付けずアプリUI既定の選択不可を維持する。
- `.markdown-body`内の操作ボタンは`user-select: none`へ戻し、本文内UIのラベルが選択対象へ混入しないようにする。
- `input`、`textarea`、`[contenteditable="true"]`も`user-select: text`へ戻し、検索・設定等の入力操作を維持する。
- 個々のタブ・ツリー・目次項目へ重複してクラスを追加せず、アプリ外枠で既定値を定めて選択可能領域だけを明示する。

## 3. 検証

- `resize-drag`のcapture喪失・非主ポインターをユニットテストする。
- `ResizeHandle`が`focus-visible`リングを使うことをコンポーネントテストする。
- 実WebView2のcomputed styleと実ドラッグで、Sidebar・目次双方のドラッグ解除、ウェルカムを含むUI文字選択の抑止、Markdown本文と入力欄の選択維持を確認する。
