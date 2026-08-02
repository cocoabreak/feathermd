# 実装タスク: ローカルフォント (local-fonts)

凡例: `[ ]` 未着手 / `[x]` 完了 / `[-]` 対象外・スキップ

## T-001: Rust管理領域と形式検証

- [x] `body` / `code` の固定slot型と管理領域解決を実装する
- [x] WOFF2 / TTF / OTFの拡張子・シグネチャ検証を実装する
- [x] 1件32 MiB、合計64 MiBの上限付き読込を実装する
- [x] 管理領域とslotのsymlink/reparse、管理領域外参照を拒否する
- [x] 境界値、不一致形式、破損、危険パスのRustテストを追加する

## T-002: ネイティブ選択・原子的コピー・削除

- [x] `pick_local_font` を共有ネイティブダイアログ制御下で実装する
- [x] 選択した同一ファイルハンドルから検証・上限付きコピーを行う
- [x] 一時ファイルから固定slotへの置換と失敗rollbackを実装する
- [x] WebView解析用candidateの読込、成功時commit、失敗時discardを実装する
- [x] 元パスを含まないメタデータとフォント本体を単一slotコンテナへ格納する
- [x] `remove_local_font` を固定slot限定で実装する
- [x] 置換、解除、途中失敗、不完全・破損コンテナのRustテストを追加する

## T-003: 状態取得とバイナリIPC

- [x] `get_local_font_status` で再検証済みメタデータとslot別エラーを返す
- [x] `read_local_font` を `tauri::ipc::Response` のraw binary応答で実装する
- [x] コマンドをmain WebView限定capabilityへ追加する
- [x] 任意パスを入力できず、固定slot以外を読み取らないテストを追加する

## T-004: フロントエンド状態と適用

- [x] `localFontsEnabled` を設定型、既定値、保存・復元へ追加する
- [x] ローカルフォントruntime storeと世代管理を実装する
- [x] raw binary応答を `FontFace`へ登録し、失敗時にフォールバックする
- [x] `.markdown-body`の本文・コード領域だけへstyleを適用する
- [x] 置換、解除、無効化時に旧FontFaceとstyleを破棄する
- [x] 成功、片側失敗、古い非同期結果、適用範囲のテストを追加する

## T-005: 設定UIと既存機能統合

- [x] 表示カテゴリへ有効トグルと本文用・コード用の管理UIを追加する
- [x] 元パスを表示せず、ファイル名、形式、サイズ、slot別エラーを表示する
- [x] 日本語・英語文言を追加する
- [x] ローカルフォント開始後にカスタムCSSを開始し、CSS後勝ちを保証する
- [x] 印刷前にフォント適用と `document.fonts.ready` を期限付きで待つ
- [x] 単一HTMLへフォントデータ・管理領域参照が混入しないことをテストする

## T-006: CJK・実アプリ検証

- [x] CJK表示確認用Markdown fixtureを用意する
- [ ] Noto Sans CJK JPを本文用に選択し、日本語字形と即時反映を確認する
- [x] Noto Sans Mono CJK JPをコード用に選択し、日本語を含むコード表示を確認する
- [ ] 再起動、元ファイル移動・削除、ズーム、タブ切替、解除を確認する
- [ ] カスタムCSS、印刷/PDFとの共存を確認する
- [x] 通常版とperformance版で管理コピーが分離されることを確認する
- [x] Noto本体・絶対パス・OSユーザー名がgit差分やartifactへ混入しないことを確認する

## T-007: 検証・レビュー

- [x] frontend format / lint / check / testを完了する
- [x] Rust fmt / Clippy / testを完了する
- [ ] 必要なrelease実アプリ確認を完了する
- [x] 設計・差分レビューを完了する
- [x] セキュリティレビューを完了する
- [x] 未解決P0/P1/P2がないことを確認する
