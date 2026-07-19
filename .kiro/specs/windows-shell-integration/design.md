# 技術設計: Windowsシェル統合とCLI入力

## ステータス

完了

## 1. Windows右クリック動詞

Windows公式の静的verb登録に従い、以下の2か所を現在ユーザーの`HKCU\\Software\\Classes`配下へ作成する。

```text
SystemFileAssociations\\.md\\shell\\FeatherMD.Open
SystemFileAssociations\\.markdown\\shell\\FeatherMD.Open
```

各verbは固定された以下の値だけを持つ。

- 既定値: `FeatherMDで開く`
- `Icon`: `"<current_exe>",0`
- `MultiSelectModel`: `Document`
- `command`の既定値: `"<current_exe>" "%1"`

`SystemFileAssociations`の補助動詞なので、ユーザーの既定ProgIDを変更しない。HKCU配下のため昇格も不要。Windows 11の新しい短縮メニューへ直接載せるIExplorerCommand/COM実装は行わない。

Rustコマンドは次の固定APIだけを公開する。

```rust
get_shell_integration_status() -> ShellIntegrationStatus
set_shell_integration_enabled(enabled: bool) -> ShellIntegrationStatus
```

任意のキー、値、実行ファイルをWebViewから指定できる汎用APIにはしない。実行ファイルは`std::env::current_exe()`から取得する。状態は両拡張子のcommand値が現在の期待値と完全一致するときだけ`registered = true`とする。

登録途中で失敗した場合は両方のFeatherMD verbを削除してロールバックする。解除はFeatherMD verbサブツリーだけを削除し、親の拡張子・shell・他動詞へ触れない。最後に`SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, ...)`を呼ぶ。

## 2. 設定UI

設定の「ファイル」に「Windows連携」セクションを追加する。コンポーネント初期化時にRustから実状態を取得し、supported=falseならセクションを表示しない。

登録状態そのものを`settings.json`へ二重保存しない。レジストリが永続状態かつ唯一の正とし、古い実行ファイルパスを指す登録をONとは表示しない。処理中はトグルを無効化し、失敗時は元の実状態へ戻してインラインエラーを表示する。

## 3. CLI入力

既存の`commands::launch`、single-instanceコールバック、`+page.svelte`の`processPaths`を維持する。新しいCLIプラグインは追加せず、パス入力に必要な最小処理だけをRustに置く。

```text
初回起動
  std::env::args + std::env::current_dir
  → 最大32件を起動cwd基準で絶対化
  → AllowedRoots::register_input_paths
  → LaunchState（初回引数）
  → get_cli_argsで回収 → processPaths

2回目起動
  single-instance callbackのargs + cwd
  → 最大32件を2回目起動cwd基準で絶対化
  → AllowedRoots::register_input_paths
  → LaunchStateのbounded pending queueへ保持
  → open-cli-args event（起床通知のみ）
  → get_cli_argsで回収 → processPaths
```

`processPaths`はstat後に既存の`openMarkdownFile` / `openFolder` / `openArchive`へ委譲する。これによりサイズ確認、DocumentSource登録、履歴、タブ、watcherを共通化する。

CLI引数本体はイベントpayloadへ載せずRust側へ保持する。フロントはlistener登録をawaitした後、初期化完了時と通知受信時に`get_cli_args`で回収する。これにより起動初期化中やWebView再読み込み中に通知が届かなくても、次の回収で入力を失わない。保留数は初回引数との合計で最大32件とする。

## 4. 信頼境界

ADR-009に従い、CLI/DnDの信頼登録はRustがOSから直接受け取ったパスだけを対象にする。`open-cli-args`と`tauri://drag-drop`は表示処理を開始する通知であり、イベントを偽装しても`AllowedRoots`は増えない。

Markdown単体は既存方針どおり親フォルダー、フォルダー入力はそのルート、ZIPはアーカイブ単体だけを登録する。最大32件制限も維持する。

## 5. 互換性とライフサイクル

- portable実行ファイルを移動すると既存verbは古いパスを指すため、設定はOFF表示になる。再度ONにすれば現在のパスへ更新する。
- アプリを削除する前にOFFへ戻さなかった場合、ユーザー別verbが残る可能性がある。インストーラー固有のアンインストールフックは本specの対象外とし、UI説明と将来の配布設計で扱う。
- 非Windowsではコマンドが`supported = false`を返し、設定UIを表示しない。CLI入力自体はデスクトップ共通で維持する。
