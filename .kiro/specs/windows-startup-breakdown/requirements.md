# 要求定義: Windows起動時間の分解とwarm停滞改善 (windows-startup-breakdown)

## 背景・動機

Windows release性能ベースラインでは、cold起動中央値が約2.95秒、warm起動中央値が約3.04秒で、warmがcoldより速くならなかった。現在の計測はプロセス起動要求から空状態UIの操作可能確認までを単一値にしており、WebView2生成、CDP接続、document ready、操作可能判定のどこが支配的か判断できない。production専用フックを追加せず、runner側だけで区間を分解し、warm停滞の原因に限定した改善を行う。

## スコープ

- **対象**: Windows x64 release performance build、cold/warm各5試行、runner側の起動マイルストーン、区間別集計、同一環境での改善前後比較
- **対象外**: productionフロントエンドへの計測フック追加、通常版の起動経路・AppData・single-instance変更、hosted runnerでの時間ゲート、Windows以外の起動最適化

## ユーザーストーリー

### US-001: 起動区間の可視化

As a メンテナー
I want to release起動時間をrunner側の区間へ分解したい
So that 支配要因を推測ではなく実測で特定できる

**受け入れ条件**

- [x] プロセス起動、CDP listener、CDP target、document ready、操作可能判定の5区間をrunner側の単調増加時計で記録する
- [x] 区間の開始・終了は既存の所有確認とproduction UI操作を使い、production専用フックを追加しない
- [x] 各区間値は有限・非負で、総起動時間との時系列整合を検証する
- [x] cold/warmそれぞれ5試行の個別値、中央値、最小、最大を機械可読artifactへ含める
- [x] 途中失敗や区間欠損を0 msまたは前回値で成功扱いしない

### US-002: warm停滞の原因特定と改善

As a メンテナー
I want to cold/warmの区間別結果を比較したい
So that warm起動を支配するrunnerまたはアプリ側の処理だけを改善できる

**受け入れ条件**

- [x] 同じrelease buildと基準環境で、改善前のcold/warm各5試行を記録する
- [x] 支配区間とwarmがcoldより速くならない理由を記録する
- [x] 原因に対応する最小の改善だけを実施するか、改善不能なら根拠を残す
- [x] 改善後も同じ5試行条件で再計測し、総時間と対象区間の前後差を記録する
- [x] 改善によって完了条件を弱めたり、固定sleepで見かけの値を短縮したりしない

### US-003: 隔離・安全境界の維持

As a 利用者
I want performance計測が通常利用中のFeatherMDへ影響しないでほしい
So that 計測中も通常版の設定・入力・プロセスが保護される

**受け入れ条件**

- [x] 通常版とperformance版のAppData、WebView profile、single-instance名前空間を分離したままにする
- [x] PID、作成時刻、実行ファイル、Job、CDP listener/profileの所有確認を維持する
- [x] 通常版または別performance版の起動競合時は入力・終了せずfail-closedに停止する
- [x] 時間・メモリをhosted runnerのCIゲートへ追加しない

## 非機能要求

- 区間分解の追加で総起動時間 `startup-cold` / `startup-warm` の定義を変更しない
- 新規区間scenarioは既存結果スキーマversion 3のtiming entryとして表現する
- 古いベースラインに新規区間がない場合、既存総時間の比較値を失わず、新規区間だけを比較不能として扱う
- 公開artifactへ絶対パス、ユーザー名、コマンドライン、WebView profileパスを保存しない

## 未決定事項（設計フェーズで決定）

- [x] 起動マイルストーンをproduction側とrunner側のどちらで記録するか
- [x] 既存結果スキーマを更新するか
- [x] cold/warmで同じ区間名をどう区別するか
- [x] 改善前後の比較条件をどう固定するか
