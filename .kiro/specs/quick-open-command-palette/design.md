# 技術設計: クイックオープンとコマンドパレット

## ステータス

完了

## 1. 共通Picker

`PickerDialog.svelte`へ検索入力、最大100件の候補、選択状態、ArrowUp/Down、Enter、Esc、フォーカストラップを集約する。候補は`PickerItem`（id / label / detail / keywords / shortcut）へ正規化し、用途固有の処理は選択コールバックへ分離する。

検索は小文字化した文字列に対し、完全一致→前方一致→部分一致→文字順を保つfuzzy matchの順でスコアを付ける。主表示のファイル名・コマンド名を副表示やkeywordsより優先し、同点はlabelとidで決定的に並べる。ハイライトは一致位置をテキスト分割して描画し、`{@html}`は使わない。

開閉状態は`pickerStore`の`quickOpen | commandPalette | null`で排他的に管理する。

## 2. クイックオープン

Rustの`SourceRegistry`へ`list_source_markdown_documents`コマンドを追加する。source idから登録済みbackendを取得し、ネイティブは`WalkBuilder`、ZIPは登録時索引を使ってMarkdownの`DocumentRef`を返す。ネイティブ候補は各パスを`AllowedRoots`で再検証し、既存の10,000走査上限、隠しファイル設定、gitignore設定を維持する。走査は`spawn_blocking`へ移す。

フロントはPickerを開くたびに現在の`explorerStore.source`を列挙し、結果をファイル名＋相対パスへ変換する。選択後は既存`openSourceMarkdown`を呼ぶため、サイズ確認、タブ重複、watcher、ZIP再検証を迂回しない。request generationで閉じたPickerや変更前ソースからの結果を破棄する。

## 3. コマンドパレット

既存`Command`へ任意の動的`label`を追加し、ラベルを持つコマンドだけをパレットへ公開する。ラベルは関数として現在のi18n辞書を読むため、言語変更で登録をやり直さない。ショートカットは既存keymapの逆引きで表示する。

`quickOpen.open`と`commandPalette.open`も通常コマンドとして登録し、ネイティブメニュー、keymap、パレットが同じ実行経路を共有する。`settings.close`と`tab.jumpTo:*`はラベルを持たせず内部コマンドのままにする。

## 4. ショートカットと印刷

`Ctrl+P`を`quickOpen.open`、`Ctrl+Shift+P`を`commandPalette.open`へ割り当てる。既存の印刷用`Ctrl+P`は競合するため解除する。`export.print`自体とファイルメニュー項目は維持し、コマンドパレットからも検索・実行できる。

## 5. 安全性と上限

- 候補パスを直接ネイティブパスとして開かず、登録済みsource idと正規化済みvirtual pathの`DocumentRef`を使う
- 新コマンドは`SourceRegistry`と`AllowedRoots`のみを信頼し、WebView指定のrootを受け取らない
- Markdown、パス、検索語、翻訳文字列はSvelteテキスト補間だけで描画する
- 表示100件、列挙/走査10,000件の上限を設ける
- 新規Tauri capability、外部通信、依存ライブラリ、永続化を追加しない
