# 実装タスク: Windows起動時間の分解とwarm停滞改善 (windows-startup-breakdown)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

## T-001: 起動マイルストーン

- [x] Job起動要求、所有PID、CDP listener、CDP target、document、操作可能の時刻をrunner側で記録する
- [x] マイルストーンの有限性と単調非減少を検証する
- [x] 5区間と総起動時間を0.001 ms単位で算出する
- [x] production専用フック・Tauriコマンド・起動引数を追加しない

## T-002: cold/warm集計

- [x] cold/warmそれぞれへ5区間scenarioを追加する
- [x] cold fixture試行とwarm reusable workspace試行で同じ区間フィールドを使う
- [x] warm primingを集計から除外する
- [x] 区間欠損、逆転、試行不足を失敗としてartifactへ残す
- [x] compose時に新規scenarioの完全性を検証する

## T-003: 原因特定と改善

- [x] Windows releaseで改善前のcold/warm各5試行を完走する
- [x] 支配区間とwarm停滞への寄与を記録する
- [x] 原因に限定した最小改善を実施するか、改善不能の根拠を残す
- [x] 同じ条件で改善後のcold/warm各5試行を完走する
- [x] 総時間と対象区間の前後差、自然変動に対する判断を記録する

## T-004: 検証・レビュー

- [x] format / lint / check / frontend test / buildを完了する
- [x] Rust fmt / Clippy / testを完了する
- [x] AppData、profile、single-instance、Job、CDP所有境界が不変であることを確認する
- [x] 設計・差分レビューを完了する
- [x] セキュリティレビューを完了する
