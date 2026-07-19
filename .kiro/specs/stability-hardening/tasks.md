# 実装タスク: 安全性・安定性の強化 (stability-hardening)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

## T-001: 改修前ベースライン

- [-] Lightning CSS関連は本改修から除外する
- [x] 主要性能ケースのベースラインを記録する

## T-002: capabilityの強化

- [x] opener capabilityを最小化する
- [x] exportをRustネイティブ保存へ移し、WebViewのfs依存・権限を削除する
- [x] PostCSS実装のままcustom CSS多重適用をlatest-onlyにする
- [-] 画像通信ポリシー変更は表示回帰を避けるため除外する

## T-003: 検索・画像・Mermaidの負荷制御

- [x] ファイル内正規表現検索を安全な実行系へ移す
- [x] ハイライト解除を線形化し一致数を制限する
- [x] ローカル画像のdedupe・並列・件数・世代制御を実装する
- [x] Mermaid印刷前描画をbounded concurrencyにする
- [x] 全文検索のblocking分離・latest-only・総量制限を実装する
- [x] Wikiリンク索引を導入する

## T-004: 非同期ライフサイクルと保存

- [x] listener登録とdestroy競合を解消する
- [x] Markdown/画像のstale resultを破棄する
- [x] DOM後処理資源を空状態・destroy時に解放する
- [x] 状態保存をdebounce＋single-flight化する
- [x] `Ctrl+R` / `Cmd+R` / `F5`を保存flush後の再読込へ変更する

## T-005: watcherとRust責務分割

- [x] watcherを共有workerへ集約する
- [x] watcherの同一パス登録を冪等にする
- [x] watcher上限とExplorer一括reconcileを追加する
- [x] 外部エディター認可・起動を`file/external_editor.rs`へ分離する
- [x] `file.rs`をセキュリティ境界単位で分割する
- [x] FS command不変条件を再レビューする

## T-006: 総合検証

- [x] frontend check / test / build
- [x] Rust fmt / Clippy / test
- [x] npm audit / cargo audit
- [x] Windows実アプリの主要動作確認
- [x] 性能計測と結果記録
- [x] 設計・差分レビュー
- [x] セキュリティレビュー
