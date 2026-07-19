# 設計: Explorerルートの限定永続信頼

## 境界

WebViewへ公開していたtauri-plugin-storeの汎用load/set/save権限を外し、Rustコマンドは`settings`、`tabs`、`recent`の固定識別子だけを受け付ける。永続信頼は別の`trusted-root.json`へRust内部からのみ保存する。

## 更新と復元

- `pick_folder`: Rustが直接受け取った選択結果を現在の唯一の永続ルートへ置換する。
- `authorize_folder_path`: 現在の永続ルートとcanonical pathが完全一致する場合だけ無確認で再利用する。それ以外は一時的な`AllowedRoots`内であってもRustネイティブ確認を表示し、承認後に置換する。通常の`authorize_path`（ファイル、リンク等）は永続ルートを変更しない。
- 起動時: 保存値を`AllowedRoots::root_for_path`で再検証し、ディレクトリの場合だけ登録する。不正値は削除する。

ローカルの同一OSユーザーによるアプリデータ改ざんは脅威モデル外とする。一方、悪意あるMarkdownからのWebView侵害では固定状態コマンドしか呼べず、`trusted-root.json`へ到達できない。
