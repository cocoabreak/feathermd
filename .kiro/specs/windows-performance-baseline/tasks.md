# 実装タスク: Windows性能ベースライン (windows-performance-baseline)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

## T-001: 結果スキーマと固定fixture

- [x] 環境、source、build、timings、memoryを含むバージョン付きJSONスキーマを定義する
- [x] 個人環境情報と絶対パスを結果から除外する検証を追加する
- [x] `plain-v1` と `rich-v1` の決定的なMarkdown fixtureを用意する
- [x] fixture ID、内容、バイト数、完了判定マーカーをテストする
- [x] 生artifactをgitignoreへ追加する

## T-002: Vite・配布物サイズ計測

- [x] Vite出力の全体・種別別rawサイズとBrotliサイズを収集する
- [x] manifestとimport graphから初期ロード集合と遅延集合を分類する
- [x] 解析時だけSvelteKit内部manifestをperf manifestとしてコピーし、通常productionビルドとTauri成果物へ混入しないことを検査する
- [x] KaTeX、Mermaid、Shiki等の主要遅延chunkを機能グループへ正規化する
- [x] 実行ファイル、MSI、NSIS、portable ZIPのうち指定された配布物サイズを収集する
- [x] 欠損、分類不能、重複chunkをfail-closedに扱うテストを追加する

## T-003: 隔離済みrelease WebView性能runner

- [ ] 通常版と異なるidentifier・表示名だけを指定するTauri performance設定overlayを追加する
- [ ] productionフロントエンドとRust release最適化を使うperformance実行ファイルをビルドする
- [ ] 通常版とperformance版のsettings、tabs、recent、trusted rootが相互に読み書きされない統合テストを追加する
- [ ] performance実行ファイルをCLI引数なしで専用AppData・プロファイル・loopback CDPポートから起動する
- [ ] 通常版またはperformance版の既存インスタンスを検出した場合は終了・入力せず開始前に拒否する
- [ ] preflight後に通常版が起動した試行を背景条件違反として破棄し、通常版を終了しないテストを追加する
- [ ] 起動PID・専用WebViewプロファイル・CDPターゲットの所有確認後だけfixtureを送る
- [ ] CLI/single-instanceの既存経路でfixtureを開き、production専用フックなしで状態を観測する
- [ ] cold/warm起動、plain初回・再表示、rich初回・再表示の完了条件を実装する
- [ ] coldは試行ごとにprofileとAppDataを初期化し、warmは計測外priming後に再利用して、それぞれ5回の結果を保存する
- [ ] plain/richを別suiteとして各5個の新規隔離セッションで実行し、各セッション内でfirst→同内容別名repeatの順に計測する
- [ ] 空状態ready直後にfixtureを送り、要求までの遅延と別suite由来キャッシュが混入しないことを検査する
- [ ] タイムアウト、試行不足、異常終了を失敗として記録する
- [ ] 起動時のPID、作成時刻、実行ファイル、親子関係を保持し、終了直前にidentityを再検証する
- [ ] PID再利用、主PID消失、起動競合時に、所有を確認できないPIDを終了しないテストを追加する
- [ ] performance AppDataの解決先を検証し、通常版AppDataや親ディレクトリを削除しないテストを追加する

## T-004: Windowsメモリ計測

- [ ] Tauri PIDを根としてWebView2を含む子孫プロセスを列挙する
- [ ] `WorkingSet64` と `PrivateMemorySize64` を個別・合計で記録する
- [ ] 空状態、plain表示後、rich表示後の安定時点で採取する
- [ ] PID消失、プロセス入れ替わり、部分集計を `not-measured` として扱う
- [ ] 模擬プロセスツリーで子孫集計、重複排除、消失時のテストを追加する

## T-005: レポートと比較

- [x] JSONスキーマ検証とMarkdownサマリー生成を実装する
- [ ] 同じschema、fixture、環境ID、ビルド種別のベースラインだけを比較する
- [ ] サイズ・時間・メモリについて現在値、基準値、差分量、差分率を表示する
- [ ] 途中失敗でも取得済み結果と失敗理由をartifactへ残す
- [ ] 比較不能な結果を0または前回値で成功扱いしないテストを追加する

## T-006: CIとリリースQA

- [x] Windows CIで通常build後にSvelteKit内部manifestを解析用コピーし、サイズ計測とartifact生成を実行する
- [x] サイズのJSONとMarkdownをGitHub Actions artifactへ保存する
- [x] 解析出力を破棄して通常production buildを再実行し、perf manifest不在を確認してからTauriをビルドする
- [x] 導入時はレポートのみとする
- [ ] 複数回の結果から自然変動を確認する
- [ ] ベースライン確定後、初期ロードと総Vite出力の大幅回帰上限を別変更で設定する
- [x] 時間・メモリをhosted runnerのCIゲートへ含めない
- [ ] Windows実機のリリースQA手順へrelease計測コマンドと結果確認を追加する

## T-007: 初回ベースラインと軽量化候補

- [ ] Windows基準環境を定義し、必要な環境情報だけを記録する
- [ ] 現行releaseの配布物、Vite出力、起動、plain/rich表示、メモリを計測する
- [ ] 同じcommitで再実行し、結果の再現性と変動幅を確認する
- [ ] レビュー済みのベースラインJSONとMarkdown要約を保存する
- [ ] 主要コスト要因を特定し、効果・リスク・実装コストで軽量化候補を順位付けする
- [ ] 候補ごとに後続Issueまたは見送り理由を記録する

## T-008: 検証・レビュー

- [x] frontend format / lint / check / test / buildを完了する
- [ ] Rust fmt / Clippy / testを完了する
- [ ] Windows release実アプリで全計測シナリオを完走する
- [x] 計測用フック、fixture、個人環境情報がproductionバンドルへ混入しないことを確認する
- [x] 設計・差分レビューを完了する
- [x] セキュリティレビューを完了する
