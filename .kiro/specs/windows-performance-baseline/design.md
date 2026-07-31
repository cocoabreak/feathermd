# 技術設計: Windows性能ベースライン (windows-performance-baseline)

## ステータス

完了

## 1. 計測の分離方針

既存の `app/e2e/smoke.mjs` は機能の正否を短時間で判定するsuiteとして維持する。性能計測は複数回の再起動、releaseビルド、メモリ採取、結果保存を必要とするため、独立した `app/perf/measure.mjs` とする。起動、CDP接続、条件待機、プロセス終了等の低レベル処理だけを `app/scripts/webview2-driver.mjs` から再利用する。

役割を次の3層へ分ける。

- `app/perf/build-metrics.mjs`: Vite出力と任意のWindows配布物から決定的なサイズ指標を収集する
- `app/perf/measure.mjs`: release実行ファイルを起動し、CDPで起動・表示時間を観測し、Windowsのプロセス情報からメモリを採取する
- `app/perf/report.mjs`: 結果スキーマの検証、ベースラインとの差分計算、Markdownサマリー生成を行う

スモークと性能計測のfixture生成処理は共通化してよいが、性能fixtureの内容とサイズを変更した場合はベースライン互換性が失われるため、fixture IDとスキーマバージョンを結果へ記録する。

## 2. 基準環境と実行モード

主ベースラインはWindows x64のTauri performance releaseビルドとする。これは通常版と同じproductionフロントエンド、Rustソース、release最適化を使い、Tauri設定overlayでidentifierと表示名だけを性能計測用名前空間へ変更したビルドである。実配布物そのもののファイルサイズは通常版成果物から別途採取する。結果には少なくとも次を含める。

- Windowsのエディション、バージョン、ビルド番号
- CPUモデル、論理プロセッサ数、物理メモリ量
- ストレージ種別を含む任意の基準環境メモ
- WebView2 Runtime、Node.js、Rust、Tauri CLIのバージョン
- FeatherMDのcommit SHA、アプリバージョン、dirty worktreeの有無
- 計測スキーマ、fixture ID、ビルド種別、実行日時

実在する絶対パス、OSユーザー名、端末名は結果へ保存しない。比較可能性を損なう変更があった場合は既存値を上書きせず、新しい環境IDまたはスキーマバージョンでベースラインを作る。

コールド起動は専用WebViewプロファイルとperformance AppDataを各試行前に空へ戻した起動、ウォーム起動は1回の計測外priming起動後に同じWebViewプロファイルとperformance AppDataを再利用する後続起動と定義する。`startup-cold` と `startup-warm` は別シナリオとし、それぞれ5回の個別値と中央値を持つ。どちらもCLI引数なしの空状態が操作可能になるまでを計測し、文書表示時間を混ぜない。OS再起動やファイルシステムキャッシュの完全消去は通常の反復手順には含めず、必要な場合だけ別の実機QAとして記録する。

releaseビルドではdev限定の `FEATHERMD_E2E_STATE_DIR` とsingle-instance無効化を利用しない。`app/src-tauri/tauri.perf.conf.json` の設定overlayで通常版とは異なる固定identifierと表示名を指定し、tauri-plugin-storeが使うAppDataとsingle-instance名前空間を分離する。overlayはcapability、CSP、フロントエンド、Rust featureを変更しない。通常版とperformance版の4ストア（settings、tabs、recent、trusted root）が相互に読み書きされないことを統合テストで確認する。

各コールド試行でperformance AppDataを初期化するときは、Tauriのpath resolverが返すperformance identifier専用ディレクトリとの完全一致を確認する。通常版identifier、AppDataルート、親ディレクトリ、未解決パスを削除対象にしない。ウォーム試行では同じperformance AppDataを維持する。計測終了後の削除も同じ検証を通す。

## 3. 固定fixture

外部ネットワークを使わない合成Markdownを2種類用意する。

- `plain-v1`: 見出し、段落、リスト、表、引用、ローカルリンクを含み、Shiki・KaTeX・Mermaidを起動しない小規模文書
- `rich-v1`: 複数言語のコードブロック、KaTeX、Mermaidを含み、各遅延レンダラーの完了を判定できる一意マーカーを持つ文書

fixtureは内容とバイト数が決定的になるようUTF-8・LFで管理する。ユーザー文書は計測へ使用しない。画像が必要になった場合はリポジトリ内の小さな固定assetだけを使い、外部URLを含めない。

## 4. サイズ計測

`build-metrics.mjs` はproductionフロントエンドの解析ビルド後に `app/build/` を走査し、次をJSONへ出力する。

- 全ファイルのraw合計
- JavaScript、CSS、画像、フォント、その他の種別別raw合計
- Brotli圧縮した転送相当サイズ。ただし元ファイルは変更しない
- rawサイズ上位の主要ファイル
- 初期HTMLから静的importを再帰的に辿った初期ロード集合
- 初期ロード集合に含まれないJavaScript/CSSを遅延集合として分類した結果
- KaTeX、Mermaid、Shikiを含む主要遅延チャンクの対応

通常の `npm run build` はVite manifestを生成しない。解析時だけ `FEATHERMD_PERF_MANIFEST=1` を設定し、`vite.config.js` のbuild-time分岐で `build/.vite/perf-manifest.json` を生成する。`build-metrics.mjs` はこのmanifestとimport関係から、ハッシュを含むファイル名をentryまたは機能グループへ正規化する。同じ機能が複数chunkへ分割された場合はグループ合計でも比較する。manifest自身はサイズ集計から除外する。

解析後はmanifestを含む解析出力を破棄し、環境変数なしの通常productionビルドを改めて実行してTauriへ渡す。通常ビルドの `app/build/` とTauri成果物にperf manifestが存在しないことを検査する。解析用分岐はNode上のビルド設定だけに置き、クライアントコードへdefineや実行時分岐を追加しない。

Windows配布物は引数で渡された実行ファイル、MSI、NSIS、portable ZIPだけを対象にする。存在しない形式を0 byteとして扱わず `not-measured` とする。配布物サイズはローカルのリリースQAまたはrelease workflowで生成済みの成果物から採取し、Viteサイズと別セクションへ記録する。

## 5. production相当WebView計測

性能計測のための `window.__e2e` や計測専用Tauriコマンドはproductionへ追加しない。runnerは次の方法で既存の利用者経路だけを使う。

1. release実行ファイルをCLI引数なしで起動する
2. 実行単位のWebViewプロファイルを環境変数で、アプリ状態とsingle-instanceをperformance用identifierで分離する
3. WebView2のremote debugging引数を計測プロセスにだけ設定し、loopback CDPへ接続する
4. 起動したPID、専用WebViewプロファイル、CDPターゲットが同じ計測インスタンスに属することを確認する
5. 所有確認後に限り、二次起動のCLI/single-instance経路で固定fixtureを送り、本文および非同期レンダラーの完了を待つ
6. 再表示計測でも同じ経路で次のfixtureを送り、同種fixtureの表示完了を待つ

remote debuggingはrunnerが起動した計測プロセスだけに付与し、通常の配布設定、永続設定、productionバンドルへ有効化コードを追加しない。CDPポートは空きloopbackポートを動的に選び、外部インターフェースへ公開しない。

performance版のsingle-instance名前空間は通常版と分離するが、別のperformance計測との競合はあり得る。そのため主起動へCLI引数を渡さず、runnerが起動したPIDと専用WebViewプロファイルのCDPターゲットを所有できたことを確認するまでfixtureを送らない。別のperformanceインスタンスが競合に勝った場合は入力せず計測を停止する。再表示用の二次起動は、runnerが起動した主PIDとCDPターゲットが引き続き存在することを確認してから行う。

性能値の背景条件を固定するため、preflightでは通常版とperformance版の両方をidentifier、実行ファイル、プロセス情報から検出する。どちらかが起動中なら終了や入力を行わず計測を拒否する。preflight後に通常版が起動しても名前空間は分離されるため入力は交差しないが、その試行は背景条件違反として破棄し、通常版を終了しない。

起動時に主プロセスのPID、作成時刻、正規化済み実行ファイルパスを記録する。終了直前に同じidentityを再取得し、作成時刻または実行ファイルが異なる、主PIDがすでに消失している、子孫関係を確認できない場合は `taskkill` を実行しない。条件が一致する場合だけ主PIDのプロセスツリーを終了し、プロセス名による一括終了は行わない。将来Windows Job Objectを導入できる場合は、同等以上の所有保証として置き換えてよい。

### 計測区間

- `startup-cold`: 空のperformance AppDataと新規WebViewプロファイルで、runnerがプロセス起動を要求してから、CLI引数なしの空状態UIが操作可能になるまで
- `startup-warm`: 計測外priming後のperformance AppDataとWebViewプロファイルを再利用し、runnerがプロセス起動を要求してから、CLI引数なしの空状態UIが操作可能になるまで
- `first-render-plain`: plain fixtureのオープン要求から、本文マーカーと通常Markdownの同期後処理が完了するまで
- `first-render-rich`: rich fixtureのオープン要求から、本文マーカー、Shiki、KaTeX、Mermaidの各完了要素が揃うまで
- `repeat-render-plain` / `repeat-render-rich`: 同じプロセス内で別名だが同内容のfixtureを再度開き、同じ完了条件を満たすまで

時刻はrunner側の単調増加時計を主とする。CDP接続前の起動時間をWebView内時計だけで測らない。固定sleepは安定待ちの補助に限定し、完了判定は期限付きポーリングで行う。

各区間は既定5回計測し、全試行値、中央値、最小、最大を保存する。coldの各試行はprofileとAppDataを初期化し、warmの5試行は1回の計測外priming後に同じprofileとAppDataを再利用する。タイムアウトやプロセス終了は失敗試行として理由を残し、中央値から除外する。成功試行が既定回数に満たない場合は計測全体を失敗とする。外れ値は自動削除せず、中央値で影響を抑えつつ個別値を確認可能にする。

文書表示はplainとrichを別suiteにし、それぞれ5個の新規隔離セッションで計測する。各セッションは空のperformance AppDataと新規WebViewプロファイルからCLI引数なしで起動し、空状態UIが操作可能になった直後に固定sleepを挟まず対象fixtureを送って `first-render-*` を測る。完了後、同内容・別名のfixtureを同じプロセスへ送り `repeat-render-*` を測ってから終了する。plainとrichを同じプロセスで先に開かず、Shiki、KaTeX、Mermaidのキャッシュを別suiteから持ち越さない。空状態readyからfixture要求までの遅延も記録し、runner側の停止や競合で大きく遅れた試行を正常値へ混ぜない。

## 6. メモリ計測

メモリは各シナリオの表示完了後、短い安定判定期間を経て採取する。

- 空状態
- plain fixture表示後
- rich fixture表示後

Windowsのプロセス情報から、起動したTauri PIDを根として子孫PIDを列挙し、WebView2プロセスを含むツリー全体を同一スナップショットとして集計する。主指標はプロセスごとの `WorkingSet64` と `PrivateMemorySize64` の合計とし、対象PID、プロセス数、個別値もJSONへ含める。ブラウザープロセスが別の所有ツリーへ移って追跡できない場合は正常値として部分集計せず、その試行を `not-measured` にする。

メモリはガベージコレクションを強制せず、実利用状態を観測する。OSやWebView2の揺らぎが大きいためCIゲートにはせず、同一Windows基準環境のリリースQA比較に使用する。

## 7. 結果とベースライン

生結果は `app/perf/artifacts/result.json`、人間向け要約は `app/perf/artifacts/summary.md` へ生成し、gitignore対象とする。JSONは概ね次の構造を持つ。

```ts
type PerformanceResult = {
  schemaVersion: number;
  fixtureVersion: string;
  source: { commit: string; appVersion: string; dirty: boolean };
  environment: Record<string, string | number>;
  build: BuildMetrics;
  timings: ScenarioMetrics[];
  memory: MemoryMetrics[];
};
```

リポジトリへ確定値を残す場合は、個々の実行artifactではなく、環境IDと計測日を明記したレビュー済みベースラインJSONおよび要約だけを `app/perf/baselines/` に置く。個人環境情報や絶対パスを含まないことを検査してから追加する。

比較処理は同じ `schemaVersion`、`fixtureVersion`、環境ID、ビルド種別の結果だけを直接比較する。互換性がない場合は差分率を出さず理由を表示する。

## 8. CIと回帰判定

GitHub Actionsの既存 `windows-desktop-build` は、perf manifest付き解析build、サイズ計測とartifact保存、解析出力の破棄、環境変数なしの通常production build、perf manifest不在検査、Tauri buildの順に実行する。時間・メモリはhosted runnerの負荷とWebView2対話環境に左右されるため実行しない。

導入直後はサイズ結果をレポートのみとし、複数回の実測で自然変動とハッシュ分割の変化を確認する。上限を設定するときは別変更としてレビューし、少なくとも次を対象にする。

- 初期ロードJavaScript/CSSの合計
- 全Vite出力の合計
- 単一主要chunkまたは機能グループの異常増加

比較対象が存在しない、manifestを解析できない、分類不能なentryがある場合は計測を失敗させ、0 byteや前回値で成功扱いしない。小さな増減を毎回CI失敗にせず、明確な回帰だけを検出する絶対上限または許容率をベースライン確定後に定める。

## 9. エラー処理と後始末

- build出力や必須fixtureがない場合は開始前に失敗する
- CDP接続、表示完了、プロセス列挙には個別タイムアウトを設ける
- 途中失敗でも取得済み試行と失敗理由をartifactへ残す
- runner全体を `try/finally` で囲み、identityが一致するプロセスツリー、専用WebViewプロファイル、検証済みperformance AppData、一時fixtureを後始末する
- 通常版と既存performance版のFeatherMDプロセスを終了対象にせず、runnerが起動してidentityを保持するPIDだけを追跡する
- 既存インスタンスの不在確認と主プロセス起動の間に競合が発生した場合は、PIDとCDPプロファイルの所有関係を確認できなければ終了操作を行わない
- 結果の書き込み前に絶対パス、OSユーザー名、fixture本文が含まれていないことを検証する

## 10. 検証と成果物

- build metrics: fixture化したVite manifest/import graphで初期・遅延分類、圧縮サイズ、欠損をテストする
- runner: timeout、試行不足、プロセス終了、後始末、同一プロセス再表示をテストする
- memory: 模擬プロセスツリーで重複・消失・子孫集計をテストする
- 実アプリ: Windows releaseビルドでplain/richの起動、初回、再表示、メモリを計測する
- CI: サイズartifactが生成され、計測失敗を成功扱いしないことを確認する
- production境界: 計測専用フック、fixture、個人環境情報がproductionバンドルへ含まれないことを確認する

初回ベースライン取得後、サイズ、起動、描画、メモリの主要コストを特定し、効果・リスク・実装コストで軽量化候補を順位付けする。改善を実施する場合は候補ごとに後続Issueを作成し、効果を同じ計測で再確認する。
