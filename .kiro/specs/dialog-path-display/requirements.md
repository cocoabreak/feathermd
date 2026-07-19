# 要求定義: アクセス確認ダイアログのパス表示 (dialog-path-display)

## 背景

Windowsで`canonicalize`したパスの`\\?\`（verbatim）プレフィックスが、フォルダーアクセス確認ダイアログへそのまま表示されている。認可判定に使う内部パスは変更せず、ユーザー向け表示だけを通常のOS表記へ整える。

## 受け入れ条件

- [x] Windowsのローカルパス`\\?\D:\notes`をダイアログでは`D:\notes`と表示する
- [x] WindowsのUNCパス`\\?\UNC\server\share`をダイアログでは`\\server\share`と表示する
- [x] 認可判定、危険ルート判定、信頼登録、永続化にはcanonicalize済み`PathBuf`をそのまま使用する
- [x] Linux／macOSではパス文字列を変更しない
- [x] ファイル認可とExplorerルート認可の両ダイアログへ同じ表示変換を適用する

## 対象外

- Explorerルート外の表示中ファイルに対する「親フォルダーを開く」案内の仕様変更
- フロントエンドへ返すパス形式の変更
