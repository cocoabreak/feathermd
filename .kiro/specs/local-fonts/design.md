# 技術設計: ローカルフォント (local-fonts)

## ステータス

完了

## 1. 設計方針

ローカルフォントはカスタムCSSの `url()` を解禁せず、専用のRustコマンドとWebViewの `FontFace` APIで適用する。信頼起点はRustネイティブファイルダイアログに限定し、選択元を永続的な信頼済みルートへ追加しない。

選択済みフォントはTauri identifier固有のAppData配下にある固定管理領域へコピーする。WebViewが保持する設定は有効フラグだけとし、インストール状態と表示用メタデータはRust管理領域を正とする。

```text
ネイティブ選択
  -> Rust: 同一ハンドルで形式・サイズ検証
  -> identifier固有AppDataの固定slotへ原子的にコピー
  -> Rust: fixed slotから再検証してraw binary IPC
  -> WebView: FontFace(ArrayBuffer)をdocument.fontsへ登録
  -> .markdown-body限定styleを適用
```

## 2. スロットと対応形式

スロットは `body` と `code` の2件に固定する。コマンド引数は列挙値として解析し、それ以外を拒否する。

| 形式         | 拡張子   | 先頭シグネチャ             |
| ------------ | -------- | -------------------------- |
| WOFF2        | `.woff2` | `wOF2`                     |
| TrueType     | `.ttf`   | `0x00010000` または `true` |
| OpenType/CFF | `.otf`   | `OTTO`                     |

WOFF、TTC/OTC、拡張子とシグネチャが一致しないファイルはv1で拒否する。1ファイル32 MiB、2スロット合計64 MiBを上限とする。ブラウザーによるフォント解析に失敗した場合も適用成功にはしない。

## 3. Rust側の管理と信頼境界

### 3.1 管理領域

`app.path().app_data_dir()/local-fonts/` 配下だけを使用する。

```text
local-fonts/
  body.slot
  code.slot
  body.candidate
  code.candidate
```

スロットファイル名を固定することで、元ファイル名やWebView入力をパス構築へ使わない。各slotは、バージョン付き固定長ヘッダー、元ファイル名・形式・バイト数を含む長さ制限付きメタデータ、フォント本体を1つのコンテナとして保持する。元パスは保存しない。フォント本体とメタデータを単一ファイルにまとめることで、置換を1回の原子的操作として扱い、両者の片方だけが更新される状態を作らない。

通常版とperformance版はidentifierが異なるため、管理領域も分離される。

### 3.2 コマンド

- `pick_local_font(slot) -> Option<LocalFontInfo>`
  - 共有 `NativeDialogState` を取得してネイティブpickerを表示する
  - 選択されたパスを一度だけ開き、その同じハンドルからファイル情報、先頭シグネチャ、全バイトを上限付きで読む
  - 検証済みメタデータとフォント本体を管理領域内の一時コンテナへ書き、`sync_all`後に固定candidateへ原子的に置換する
- `read_local_font_candidate(slot) -> tauri::ipc::Response`
  - 固定candidateを再検証し、WebViewの`FontFace.load()`による最終解析用にraw bytesを返す
- `commit_local_font_candidate(slot)` / `discard_local_font_candidate(slot)`
  - WebView解析成功後だけcandidateを固定slotへ原子的に置換する
  - 解析失敗時はcandidateだけを削除し、直前の正常slotを維持する
- `get_local_font_status() -> LocalFontStatus`
  - 固定管理領域だけを走査し、再検証済みのメタデータまたはスロット別エラーを返す
- `read_local_font(slot) -> tauri::ipc::Response`
  - 固定slotをサイズ・シグネチャ再検証し、raw bytesで返す
- `remove_local_font(slot)`
  - 固定slotと対応メタデータだけを削除する

いずれも任意パス引数を持たず、`main` WebViewだけへcapabilityを付与する。管理領域やslotファイルがシンボリックリンク・reparse pointへ置換されている場合は拒否し、管理領域外を辿らない。

### 3.3 失敗時整合性

置換前の正常フォントは、新しいフォントのRust検証、一時コンテナ書込み、`sync_all`、WebViewの`FontFace.load()`が完了するまで保持する。Windowsでは既存ファイルを安全に置換できるOS API、その他のOSでは同一ファイルシステム内のrenameを使い、置換失敗時は旧slotを維持する。起動時やstatus取得時はコンテナのバージョン、メタデータ長、宣言サイズ、実サイズ、形式シグネチャを再検証する。不完全・破損slotは利用せず、削除または再選択できる状態として報告する。クラッシュ等で残った一時ファイルとcandidateは固定名とし、次回起動時に管理領域内の通常ファイルであることを確認して削除する。

## 4. フロントエンド適用

`app/src/lib/local-fonts/local-fonts.svelte.ts` が読込、`FontFace`登録、style適用、エラー、世代管理を一元化する。

- family名はアプリ固定の内部名 `FeatherMD Local Body` / `FeatherMD Local Code` とする
- `read_local_font` のraw responseを、releaseで返る数値配列も含めてBufferSourceへ正規化して `FontFace`へ渡す
- `FontFace.load()`成功後だけ `document.fonts.add()`する
- release CSPは `font-src 'self' data:` に限定し、`FontFace(ArrayBuffer)`の内部data URLだけを許可する
- 置換、解除、無効化時は旧 `FontFace`を `document.fonts.delete()`し、参照を破棄する
- 世代番号が古い非同期結果は登録・style更新へ使わない
- 一方のスロットが失敗しても、他方の正常スロットは適用する

適用styleは `custom-user-css` より前に配置する。

```css
.markdown-body {
  font-family:
    "FeatherMD Local Body",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.markdown-body :where(pre, code, kbd, samp) {
  font-family:
    "FeatherMD Local Code", ui-monospace, SFMono-Regular, Menlo, Consolas,
    monospace;
}
```

未設定スロットの規則は生成しない。KaTeX等がより具体的な専用フォントを持つ場合は上書きしない。カスタムCSSは後から挿入されるため、ユーザーの明示指定を優先する。

## 5. 設定とUI

既存 `Settings` へ `localFontsEnabled: boolean`（既定 `false`）を追加する。保存済み未知・欠損値は従来どおり既定値へフォールバックする。

設定画面の「表示」カテゴリへ次を追加する。

- 全体の有効/無効トグル
- 本文用とコード用の2行
- 各行に元ファイル名、形式、サイズ、選択/置換、解除
- スロット別の読込・検証エラー

選択元の絶対パスはWebViewへ返さず表示しない。選択直後、解除直後、有効状態変更直後に最新世代として再適用する。

起動時は `loadSettings()` 後にローカルフォントを開始し、その後にカスタムCSSを開始する。これによりカスタムCSSのカスケード優先を安定させる。

## 6. 印刷・HTML出力

`printDocument()` はプラグインの `beforePrint` と合わせ、進行中のローカルフォント適用と `document.fonts.ready` を期限付きで待ってから `window.print()` を呼ぶ。失敗スロットはフォールバックのまま印刷し、印刷操作自体は中止しない。

単一HTML出力へフォントバイト列や管理領域参照を埋め込まない。エクスポートHTMLは現在の既定フォントスタックを維持する。フォント埋め込みは成果物サイズ、ライセンス表示、共有先ブラウザー差異を別途設計する必要があるためv1対象外とする。

## 7. CJK実フォント検証

自動ユニットテストでは大容量フォントをコミットせず、形式判定用の最小バイトfixtureと `FontFace` mockを使用する。実WebView確認では、公式Noto CJK配布物を利用者がローカルに取得し、次を指定する。

- 本文: Noto Sans CJK JP（日本語向けOTF）
- コード: Noto Sans Mono CJK JP（日本語向け等幅OTF）

検証文書には漢字、ひらがな、カタカナ、句読点、全角括弧、半角英数、日本語を含むコードブロックを入れる。選択、即時反映、再起動復元、ズーム、タブ切替、解除、印刷/PDFを確認する。

Noto CJKはSIL Open Font License 1.1だが、初期実装ではフォント本体をリポジトリやCI artifactへ保存しない。将来subset等を同梱する場合は改変版として名称、著作権表示、OFL本文の同梱を別途レビューする。

## 8. テスト戦略

### Rust

- slot列挙値、固定パス、拡張子とシグネチャの一致
- 上限値ちょうど、超過、2スロット合計超過
- 同一ハンドルからの上限付きコピーと途中失敗rollback
- 置換、解除、メタデータ不一致、破損、symlink/reparse拒否
- raw binary responseが固定slot以外を読まないこと

### フロントエンド

- 設定の既定値、保存・復元、未知値の読み捨て
- `FontFace`成功・失敗、片側失敗、無効化、解除、置換
- 遅い旧世代の結果が最新状態を上書きしないこと
- style適用範囲が `.markdown-body` 内だけであること
- カスタムCSSが後勝ちになること
- 印刷待機が失敗時もフォールバックで継続すること

### 実アプリ

- Noto Sans CJK JP / Noto Sans Mono CJK JPによる日本語fixture
- 通常版とperformance版の管理領域分離
- 元ファイル移動・削除後の再起動
- 不正フォント、上限超過、管理コピー破損時のエラーとフォールバック
- 印刷/PDF、コンテンツズーム、カスタムCSSとの共存

## 9. 決定事項

- 選択元を参照せず、identifier固有のアプリ管理領域へコピーする
- WOFF2 / TTF / OTF、1件32 MiB、合計64 MiBとする
- 本文用とコード用の2スロットに限定する
- Tauri raw binary IPCと `FontFace(ArrayBuffer)`を使う
- カスタムCSSを後勝ち、印刷/PDFを対応、単一HTMLへの埋め込みを対象外とする
- CJKはNoto CJK JPの公式配布物を使う任意実アプリ検証とし、フォント本体をコミットしない
- フォント本体と表示メタデータは固定slotの単一コンテナへ保存し、1回の原子的置換で整合性を保つ
- 選択結果は固定candidateへ保存し、WebViewの`FontFace.load()`成功後だけactive slotへコミットする
