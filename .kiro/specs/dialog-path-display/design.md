# 技術設計: アクセス確認ダイアログのパス表示 (dialog-path-display)

## ステータス

完了

## 設計

- `normalize_path_for_display(&Path)`をRust側の表示専用ヘルパーとして追加する
- Windowsだけ`\\?\UNC\`を`\\`へ、`\\?\`を空文字へ置換し、区切り文字はWindows標準のバックスラッシュを維持する
- Windows以外は`Path::to_string_lossy()`の結果を変更せず返す
- `authorize_path`と`authorize_folder_path`はプロンプト組み立て時だけ表示用文字列を使う
- 承認後は変換前の`root: PathBuf`を`AllowedRoots`と永続信頼へ渡す
- 既存の`normalize_path_for_frontend`も表示専用ヘルパーを再利用し、verbatim除去処理を重複させない

## Explorer案内の判断

通常の「フォルダーを開く」で表示中ファイルを含まない別フォルダーを選んだ場合、表示中ファイルがExplorerルート外である案内は残る。これは`.kiro/specs/open-context-ui/`の仕様どおりであり、本修正では変更しない。
