# 技術設計: 安全性・安定性の強化 (stability-hardening)

## ステータス

完了

## 基本方針

一度にアーキテクチャ全体を置き換えず、攻撃面とリソース枯渇を先に閉じる。
各フェーズは独立して検証可能にし、後続のリファクタリングでセキュリティ挙動を変更しない。

## Phase 1: capability

Lightning CSS移行と画像通信ポリシーの変更は、画像表示など既存動作への影響が確認されたため本改修から除外する。カスタムCSSは`main`のPostCSS実装、画像は既存CSP・sanitize挙動を維持する。

### capability

- `opener:default`と未使用の`opener:allow-open-path`を削除し、HTTP/HTTPSのURL openだけをscope付きで許可する。
- exportの保存ダイアログと書き込みをRustコマンドへ移し、WebView側のfs依存・権限を削除する。保存先パスはWebViewへ返さない。

## Phase 2: 負荷制御

### ファイル内検索

- 正規表現はRustのlinear-time regexへ移すかWeb Workerへ隔離する。最小実装はRust commandを採用する。
- DOMハイライトは一致総数を制限し、解除時は全mark置換後に親ごと1回だけnormalizeする。
- 現在位置のclass更新は前後2要素だけを変更する。

### 画像・Mermaid

- 画像パス単位でPromiseをdedupeし、同時読込数を制限する。
- IntersectionObserverで表示付近だけ読み、render generationが変わった結果は反映しない。
- Mermaid印刷前描画は小さいworker poolで処理し、上限超過時はユーザーへ通知する。

### 全文検索・Wikiリンク

- 全文検索の同期I/Oは`spawn_blocking`へ移し、request idでlatest-onlyにする。
- 結果ファイル数・総一致数・返却payloadを制限し、UIは段階表示する。
- Wiki候補はExplorer rootとgitignore設定をkeyに索引化し、directory changeで無効化する。

## Phase 3: 非同期ライフサイクル・永続化

- 非同期listener登録を`disposed`対応helperへ集約する。
- Markdown renderと画像hydrateへgeneration tokenを導入する。
- DOM後処理cleanupを単一関数へ集約し、空状態とdestroyの双方から呼ぶ。
- 状態保存はkindごとのsingle-flight queueとdebounceを持ち、最新snapshotを最後に保存する。
- キーボード再読込は既定動作を止め、全保存キューのflush後にだけ実行する。

## Phase 4: watcher・責務分割

- デバウンス処理を共有workerへまとめる。ファイルとExplorerは各パスに利用者が1つという既存不変条件を維持し、同一パスのwatchを冪等にする。
- ファイル100件・Explorer 65件を上限とする。ExplorerはRust側台帳を唯一の正とし、一括reconcileでWebViewリロード後も最新集合へ収束させる。
- `file.rs`を最低限以下へ分割する。
  - `trusted_paths`: `AllowedRoots`、危険ルート、最終ハンドルパス
  - `dialogs`: native picker、確認排他
  - `readers`: Markdown/CSS/画像/ディレクトリ
  - `external_editor`: 実行ファイル認可・起動
  - `persistent_trust`: Explorerルート1件の永続化

## 検証

- unit: 検索上限、画像dedupe、保存順序、watch参照数
- integration: AllowedRoots外拒否、stale result非反映
- performance: 1/5/10MiB Markdown、1k/5k検索一致、100画像、10kファイル検索/Wiki
- UI: release相当でファイル/フォルダー、D&D、履歴復元、テーマ、印刷、custom CSSを確認

## 依存監査結果

- npm audit（2026-07-19再確認）: low 3件。SvelteKitが内部利用する`cookie`の不正文字検証で、静的配布する本アプリの実行経路ではCookieを生成しない。提示された自動修正は古いメジャーバージョンへの変更を含むため適用しない。
- cargo audit（2026-07-19再確認）: 既知脆弱性0件、許可済みwarning 17件。Linux向け推移依存のGTK3保守終了、`glib 0.18`のinformationalなunsound警告、保守終了した推移依存は、Tauri/WebKitGTK等の上流更新時に追従する。

## 性能計測結果

2026-07-12にWindows 11のTauri devビルド（WebView2）で、Markdown本文のDOM更新が750ms停止するまでを表示完了として計測した。入力は見出し、段落、強調、リンク、インラインコード、リストを繰り返したUTF-8文書で、同一プロセス内で1MiB、5MiB、10MiBの順に各1回計測した。値は機種間比較用の保証値ではなく、改修前後を比較するためのローカルベースラインとする。

| 入力サイズ | 結果 | DOM要素数 | JSヒープ使用量（参考） |
| --- | ---: | ---: | ---: |
| 1MiB | 4.38秒 | 51,012 | 84.7MiB |
| 5MiB | 86.30秒 | 255,059 | 178.2MiB |
| 10MiB | 180秒で打ち切り（CDPも応答不能） | 取得不能 | 取得不能 |

1MiBは待ち時間が発生するものの表示可能だった。一方、5MiB以上は通常操作として許容しない。追加対策として、Markdown読込後かつレンダリング開始前にサイズを判定し、5MiB以上では警告してユーザーの明示操作なしにレンダリングしない方針を別specで検討する。仮想化やストリーミング描画はMarkdown構文とDOM後処理への影響が大きいため、この安定化改修には含めない。

## ロールバック単位

各Phaseを論理的に独立させる。本改修は`main`を直接の起点とし、Lightning CSS移行ブランチには依存しない。
