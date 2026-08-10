# 技術設計: Windows起動時間の分解とwarm停滞改善 (windows-startup-breakdown)

## ステータス

完了

## 1. 計測方針

`app/perf/measure.mjs` の `launchReadyPerformanceApp` が既に持つrunner側の単調増加時計 `performance.now()` を使い、既存の検証境界直後にマイルストーンを記録する。productionフロントエンド、Tauriコマンド、capability、CSP、起動引数は変更しない。

マイルストーンは次の順序で固定する。

1. `startupRequestedAt`: performance Jobへ起動を要求する直前
2. `processReadyAt`: Job所有PIDのidentityとbackground条件を確認した直後
3. `cdpListenerReadyAt`: loopback CDP listenerのJob/profile/port所有を確認した直後
4. `cdpTargetReadyAt`: production Tauri URLの一意なCDP targetを確認した直後
5. `documentReadyAt`: `document.readyState`、body、origin、production hook不在を確認した直後
6. `startupReadyAt`: コマンドパレットを開きlistboxが存在することを確認した直後

総起動時間の定義は `startupRequestedAt` から `startupReadyAt` のまま維持する。5区間は隣接するマイルストーンの差とし、各値を0.001 ms単位へ丸める。全マイルストーンが有限かつ単調非減少であることを検証し、欠損・逆転時は試行を失敗させる。

## 2. scenarioと集計

cold/warmの総時間に加え、次のscenarioを各5試行で集計する。

| 区間 | cold scenario | warm scenario |
| --- | --- | --- |
| 起動要求→所有PID確認 | `startup-cold-process` | `startup-warm-process` |
| 所有PID確認→CDP listener所有確認 | `startup-cold-cdp-listener` | `startup-warm-cdp-listener` |
| listener確認→production target確認 | `startup-cold-cdp-target` | `startup-warm-cdp-target` |
| target確認→document検証 | `startup-cold-document` | `startup-warm-document` |
| document検証→操作可能確認 | `startup-cold-interactive` | `startup-warm-interactive` |

`measurePerformanceWorkspaceStartup` とfixture付きcold試行は同じ区間フィールドを返す。timing suiteは全フィールドが揃った試行だけを成功とし、区間ごとに個別値、中央値、最小、最大を生成する。priming起動はwarm結果へ含めない。

結果スキーマversion 3はtiming scenario名を固定列挙していないためversionを変更しない。`compose-result.mjs` の完全性検証だけを新規12 scenario（既存cold/warm総時間＋cold/warm各5区間）へ更新する。旧ベースラインとのレポート比較では、新規区間を片側欠損として明示し、既存総時間の比較を維持する。

## 3. 原因特定と改善

同じcommit、release build、環境ID、fixture、5試行条件で改善前のcold/warmを採取する。総時間に占める中央値が最大の区間と、cold/warm差へ寄与する区間を支配要因とする。

改善は実測後に次の優先順位で判断する。

1. runnerのポーリング間隔・重複接続・不要な直列待ちが支配する場合、完了条件と所有確認を維持してrunnerだけを改善する
2. performance専用の準備処理が支配する場合、通常版との隔離・fail-closed境界を維持して準備順序を改善する
3. productionアプリ処理が支配する場合、原因を追加調査し、影響範囲がIssue #35を超える変更は別Issueへ切り出す

改善後は同じ環境でcold/warm各5試行を再実行する。中央値、各試行、対象区間の差を保存し、自然変動（既存run間で起動最大5.23%）を超える効果かを判断する。効果が確認できない変更は残さない。

## 4. 安全性とエラー処理

- マイルストーンは所有確認の代替にせず、確認完了後にだけ記録する
- CDP portはloopback、targetはproduction Tauri URLの一意な所有targetに限定する
- 通常版や別performance版のプロセスを終了・入力しない
- 区間欠損、非有限値、逆転、試行不足はfail-closedにする
- artifactにはscenarioと時間値だけを追加し、PID・絶対パス・コマンドラインを追加しない
- interruption、Job終了、workspace cleanupの既存境界を維持する

## 5. 検証

- 単体テスト: マイルストーン順序、区間算出、cold/warm集計、priming除外、欠損・逆転・試行不足
- deterministic checks: frontend format / lint / check / test / build、Rust fmt / Clippy / test
- 実機: Windows release performance buildで改善前後のcold/warm各5試行
- production境界: production hook、通常版AppData、single-instance、所有確認が不変であること
- レビュー: 設計・差分レビュー、セキュリティレビュー

## 6. 実測結果

2026-08-10、同一のWindows x64 release performance executable、環境ID
`windows-x64-i9-9900k-64gb-sata-2026-08`、同一fixtureで改善前後を各5試行した。
アプリのバイナリは再ビルドせず、性能計測runnerのCDPポーリング候補だけを変更して比較した。

### 6.1 改善前

| scenario | 5試行 (ms) | 中央値 (ms) |
| --- | --- | ---: |
| `startup-cold` | 3606.547, 3110.301, 3125.970, 3088.567, 3214.411 | 3125.970 |
| `startup-cold-process` | — | 1359.974 |
| `startup-cold-cdp-listener` | — | 1705.343 |
| `startup-cold-cdp-target` | — | 4.529 |
| `startup-cold-document` | — | 14.920 |
| `startup-cold-interactive` | — | 54.224 |
| `startup-warm` | 3251.538, 3202.335, 3320.384, 3208.296, 3221.629 | 3221.629 |
| `startup-warm-process` | — | 1301.412 |
| `startup-warm-cdp-listener` | — | 1850.813 |
| `startup-warm-cdp-target` | — | 3.914 |
| `startup-warm-document` | — | 16.136 |
| `startup-warm-interactive` | — | 63.151 |

支配区間はprocessとCDP listenerであった。process区間には、アプリ起動前にPowerShellが
Job hostのC#ソースをコンパイルしてJob Objectを準備する時間が混入していた。warmがcoldより
95.659 ms遅い差は、主にCDP listener所有確認区間の145.470 ms増加で説明できる。
document以降はcold 69.144 ms、warm 79.287 msに留まり、production UI処理を変更する根拠はなかった。

### 6.2 改善候補の評価

支配区間にあるrunnerの固定500 ms待機を減らせるか確認するため、CDP応答ポーリングだけを
50 msへ変更した。総時間の開始・終了、応答確認、listener/profile/port所有確認、production
target確認、操作可能条件は変更せず、同じrelease executableで各5試行した。

| scenario | 5試行 (ms) | 中央値 (ms) | 改善前との差 |
| --- | --- | ---: | ---: |
| `startup-cold` | 3346.554, 3285.891, 3305.612, 3249.845, 3288.212 | 3288.212 | +162.242 ms (+5.19%) |
| `startup-cold-process` | 1469.762, 1430.140, 1401.560, 1366.445, 1406.554 | 1406.554 | +46.580 ms (+3.43%) |
| `startup-cold-cdp-listener` | 1785.875, 1772.761, 1832.039, 1807.408, 1811.429 | 1807.408 | +102.065 ms (+5.98%) |
| `startup-warm` | 3430.044, 3295.666, 3451.760, 3459.316, 3379.683 | 3430.044 | +208.415 ms (+6.47%) |
| `startup-warm-process` | 1414.826, 1356.989, 1386.023, 1445.561, 1371.593 | 1386.023 | +84.611 ms (+6.50%) |
| `startup-warm-cdp-listener` | 1930.774, 1858.281, 1955.389, 1922.198, 1919.326 | 1922.198 | +71.385 ms (+3.86%) |

短いポーリング間隔による短縮は確認できず、coldは自然変動上限内、warmは悪化したため、
この候補は最終差分から除外した。Job host準備を総時間の外へ移す案も検討したが、既存の
`startup-cold` / `startup-warm`の開始境界を変えて比較不能になるため採用しない。

### 6.3 結論

warmがcoldより速くならない差は、WebView2/CDP listenerの起動とfail-closedな所有確認の
区間に集中する。document ready以降は総時間の約3%以下であり、production UIを変更する
根拠はない。再利用profileによるこの環境での短縮効果も確認できず、安全条件を維持した
Issue #35内の低リスク改善は実測で特定できなかった。そのためproductionアプリと既存の
完了・所有条件は変更せず、区間分解と機械可読集計だけを最終実装とする。

### 6.4 最終実装の実機確認

改善候補を除外した最終コードでも、同じrelease executableでcold/warm各5試行を完走した。
各区間の個別値がartifactへ出力され、総時間との整合を確認した。

| scenario | 5試行 (ms) | 中央値 (ms) |
| --- | --- | ---: |
| `startup-cold` | 3389.671, 3245.378, 3189.627, 3456.511, 3250.526 | 3250.526 |
| `startup-cold-process` | 1467.867, 1431.485, 1400.978, 1559.069, 1394.623 | 1431.485 |
| `startup-cold-cdp-listener` | 1826.083, 1739.999, 1716.150, 1823.980, 1779.689 | 1779.689 |
| `startup-cold-cdp-target` | 6.727, 6.185, 3.595, 3.517, 5.436 | 5.436 |
| `startup-cold-document` | 29.630, 16.735, 15.260, 14.733, 20.900 | 16.735 |
| `startup-cold-interactive` | 59.365, 50.975, 53.644, 55.211, 49.878 | 53.644 |
| `startup-warm` | 3438.622, 3436.833, 3351.915, 3407.842, 3305.150 | 3407.842 |
| `startup-warm-process` | 1414.012, 1439.932, 1352.513, 1416.074, 1350.219 | 1414.012 |
| `startup-warm-cdp-listener` | 1930.903, 1916.238, 1917.094, 1904.397, 1871.929 | 1916.238 |
| `startup-warm-cdp-target` | 4.966, 3.526, 3.438, 3.986, 3.521 | 3.526 |
| `startup-warm-document` | 17.877, 15.283, 14.396, 17.119, 13.223 | 15.283 |
| `startup-warm-interactive` | 70.864, 61.854, 64.474, 66.267, 66.257 | 66.257 |
