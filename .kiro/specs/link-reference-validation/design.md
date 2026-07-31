# 技術設計: リンク参照検証の拡張

## ステータス

設計完了

## 1. 全体構成

既存の`get_source_link_context`は文書リンク索引とリンクグラフの共通応答として維持する。
画像・見出し検証は現在文書だけを起点とする新しい用途限定コマンド
`get_source_reference_validation`で取得し、`LinkInspectorStore`が文書リンク切れと統合する。

```text
LinkInspectorStore
  |-- get_source_link_context -------- 文書リンク・文書リンク切れ・グラフ
  `-- get_source_reference_validation
          |-- Rust: 画像解決・見出し構造抽出・各種上限
          `-- TypeScript: heading-anchor.tsで見出しID照合
                         |
                    統合した「問題」一覧
```

リンクグラフは`LinkContextResponse.broken`だけを使用し、新しい問題応答を参照しない。

## 2. 応答モデル

Rustは表示用の問題と、TypeScriptで照合する見出し候補を返す。

```rust
enum ReferenceProblemKind { Image }
enum ReferenceProblemStatus { Missing, OutsideSource, Unverifiable }

struct SourceReferenceProblem {
    kind: ReferenceProblemKind,
    raw_target: String,
    status: ReferenceProblemStatus,
    reference_count: usize,
}

struct HeadingValidationReference {
    document: DocumentRef,
    raw_target: String,
    anchor: String,
    kind: DocumentLinkKind,
    reference_count: usize,
}

struct HeadingValidationDocument {
    document: DocumentRef,
    headings: Vec<SafeOutlineHeading>,
    complete: bool,
}

struct ReferenceValidationResponse {
    image_problems: Vec<SourceReferenceProblem>,
    heading_references: Vec<HeadingValidationReference>,
    heading_documents: Vec<HeadingValidationDocument>,
    truncated: bool,
}
```

`raw_target`はSource内相対参照だけに制限し、NativeSourceの絶対パスは返さない。
範囲外参照は入力全体ではなく、上限付きの元参照文字列を表示する。

TypeScriptは`SafeOutlineHeading.anchorText`から既存の`withReferenceHeadingIds`で参照用IDを付与し、
共有`headingReferenceMatches`で完全ID・アンダースコア代替ID・正規化テキストを実遷移と同じ順に
照合して、欠落または検証不能の問題へ変換する。

## 3. 参照抽出と解決

### 画像

`pulldown-cmark`の`Tag::Image`だけを対象とし、コード、生HTML、通常リンクは自然に除外する。
URI schemeと`data:`は除外する。クエリ文字列は検証不能とする。フラグメントは画像パスから除く。

相対パスは現在文書の親を基準にpercent decode、バックスラッシュ正規化、
`normalize_virtual_path`を適用する。先頭`/`は既存表示経路と同じくSourceルート基準とする。
NativeSourceの絶対パスは信頼ルート内だけSource相対パスへ変換し、UNC、NUL、Sourceルート越えは
`outsideSource`とする。絶対ネイティブパスそのものは応答へ返さない。
NativeSourceは`resolve_native_path`と`open_allowed_file`、ZipSourceは中央ディレクトリの
正規化済みエントリで存在を確認する。対応画像拡張子でない参照は検証不能とする。

### 見出し

既存`extract_document_links`を拡張し、同一文書の`#anchor`も検証候補として抽出する。
文書リンクは既存索引と同じWikiFileIndexおよび`resolve_markdown_link`で解決する。
未解決文書は既存の文書リンク切れに任せ、見出し候補へ含めない。

解決済みの対象文書を制限付きで読み、既存`extract_safe_outline`で見出しの表示テキストと
アンカー計算用テキストを抽出する。Rustはslugを生成しない。これにより通常レンダー、
safe/source表示、リンクプレビューと同じTypeScript実装でUnicode・emoji・重複を扱う。

## 4. 上限とキャッシュ

- 現在文書: 10MiB（既存上限）
- 検証対象文書: 最大64件
- 検証対象1文書: 10MiB
- 検証対象文書の総読込量: 32MiB
- 1文書の見出し: 既存safe outline上限
- 見出し候補: 最大500件
- 画像参照: 最大2,000件
- 問題応答: 最大500件
- 画像問題文字列: 128KiB
- 見出し参照文字列: 256KiB
- 見出し構造文字列: 512KiB
- 応答概算: 1MiB
- 同時検証: Rust全体で1件。Storeも既存single-in-flightキューを使用

文書数・総読込量・見出し数上限、読込失敗時は対象の`complete = false`とし、TypeScript側で
`unverifiable`へ変換する。問題・文字列・応答上限では`truncated = true`とする。
応答概算はJSONエスケープの最悪ケースを考慮して各文字列バイト数を6倍し、構造体ごとの固定
オーバーヘッドを加算する。見出し構造は先頭から保持し、途中を飛ばしてID順を変えない。

結果は既存Storeのscope（Source ID、generation、表示設定、Wiki設定）へ紐付ける。
Rust側に新しい長期キャッシュは設けず、既存リンク索引の30秒TTLとStore結果を利用する。
watcherのdirty通知、generation変更、明示更新はリンク情報と検証を同時に再実行する。

## 5. フロントエンド

`LinkInspectorStore`へ`problems`を追加する。ロード時は2コマンドを同じrequest IDで実行し、
両方が最新の場合だけ状態を確定する。既存`broken`を文書リンク切れ問題へ変換し、画像問題、
見出し問題と結合して決定的に並べる。

`LinkInspectorPanel`の内部キーは`problems`、表示ラベルは「問題」とする。各項目は種別、状態、
対象パスまたは見出しを表示し、フォーカス可能だが自動修正や範囲外パスへの遷移は行わない。
出力・入力区分とリンクグラフのデータモデルは変更しない。

## 6. エラー処理と安全性

- SourceRegistryでSource IDとDocumentRefを毎回再検証する
- NativeSourceはAllowedRootsと最終ファイルハンドルパスの既存経路を通す
- ZipSourceは中央ディレクトリ検証と圧縮・展開上限を迂回しない
- 検証不能を欠落へ変換せずfail-closedに表示する
- 生Markdown、HTML、画像内容、絶対ネイティブパスを返さない
- UIは文字列を通常のSvelteテキストとして描画し`{@html}`を使用しない
- 新コマンドはメインウインドウの既存capabilityだけへ追加し、リンクグラフへ許可しない

## 7. テスト方針

- Rust単体: 画像抽出、相対解決、欠落・範囲外・Zip、同一文書アンカー、文書数・総量上限
- TypeScript単体: percent encode、Unicode、emoji、重複・空見出し、検証不能変換
- Store: latest-only、dirty、明示更新、2応答統合、片方失敗
- Component: 問題種別・状態・空・省略表示とアクセシブルな項目
- 回帰: 既存リンク索引、リンクプレビュー、リンクグラフ、safe/source outline
