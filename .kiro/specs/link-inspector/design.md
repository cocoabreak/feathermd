# 技術設計: リンクインスペクターとローカルリンクグラフ

## ステータス

設計完了

## 1. 全体構成

既存の`BacklinkIndex`をSource単位の`LinkIndex`へ拡張し、前方・後方・リンク切れを1回の
走査で構築する。既存のDocumentSource列挙、WikiFileIndex、AllowedRoots検証、ZIP読込制限を
再利用する。

```text
NativeSource / ZipSource
          |
  Source内Markdown列挙・制限付き読込
          |
      LinkIndex
   /      |       \
出力     入力     リンク切れ
   \      |       /
 get_source_link_context
          |
 LinkInspectorPanel / LinkGraphDialog
```

リンクインスペクターとグラフは同じ`LinkContextResponse`を使用する。グラフ表示のための
再走査は行わない。

## 2. Rustデータモデル

```rust
#[serde(rename_all = "camelCase")]
enum DocumentLinkKind {
    Wiki,
    Markdown,
}

#[serde(rename_all = "camelCase")]
struct DocumentLinkEdge {
    source: DocumentRef,
    target: Option<DocumentRef>,
    raw_target: Option<String>,
    anchor: Option<String>,
    kind: DocumentLinkKind,
    reference_count: usize,
}

#[serde(rename_all = "camelCase")]
struct LinkContextSection {
    items: Vec<DocumentLinkEdge>,
    total: Option<usize>,
}

#[serde(rename_all = "camelCase")]
struct LinkContextResponse {
    outgoing: LinkContextSection,
    incoming: LinkContextSection,
    broken: LinkContextSection,
    truncated: bool,
}

struct CachedLinkIndex {
    created_at: Instant,
    edges: Vec<IndexedLinkEdge>,
    outgoing_by_source: HashMap<String, Vec<LinkEdgeId>>,
    incoming_by_target: HashMap<String, Vec<LinkEdgeId>>,
    broken_by_source: HashMap<String, Vec<LinkEdgeId>>,
    truncated: bool,
}
```

`target`は解決済みの場合だけ、`raw_target`はリンク切れの場合だけ設定する。絶対ネイティブパスや生本文は返さず、SourceRegistryで
再検証可能な`DocumentRef`とSource内相対パスだけをWebViewへ返す。索引内のEdge本体は
`edges`へ1回だけ保持し、各Mapは整数IDだけを参照する。解決済みEdgeは`raw_target`を保持せず、
表示に必要なリンク切れだけ制限付きで保持する。

新規Tauriコマンド:

```rust
get_source_link_context(
    document: DocumentRef,
    show_hidden_files: bool,
    respect_gitignore: bool,
    include_wiki_links: bool,
    force_refresh: bool,
) -> LinkContextResponse
```

移行中は`list_source_backlinks`を同じ`LinkIndex`へ委譲する互換アダプターとして残す。
フロント移行と既存テスト更新後、呼び出しがなければ同じ変更系列内で削除する。

## 3. リンク抽出

### Wikiリンク

既存`extract_wiki_targets`の除外範囲、長さ制限、構文規則を維持し、見出しと生ターゲットも
返す`extract_document_links`へ一般化する。Wikiリンク解決は既存`WikiFileIndex`を使い、
表示時の前方リンク解決と同じ近接優先規則を適用する。

### Markdownリンク

`pulldown-cmark`のリンクイベントとオフセットを使用する。インラインリンクと参照形式リンクを
対象とし、画像、外部URL、同一文書アンカー、生HTML、コード範囲を除外する。

クエリ文字列付きリンクは対象外とし、フラグメントだけを`anchor`へ分離する。パス文字列は
既存の表示時遷移と同じスラッシュ正規化を行い、追加のURLデコードは行わない。NUL、絶対パス、
UNC、Sourceルートを越える`..`を拒否する。
拡張子が`.md`または`.markdown`の同一Source内パスだけを索引する。

解決処理はVirtualPathの正規化とSource内候補集合を用いる。既存の
`resolveDocumentTarget`と同じ結果になる境界値を共有テストで固定する。

## 4. 索引構築・キャッシュ

現在の`build_backlink_index`を`build_link_index`へ置き換える。1文書を読み込むたびにリンクを
抽出し、出力・入力・リンク切れの各Mapへ同時に登録する。自己文書へのファイルリンクは索引せず、
同じ対象・種別・見出しへの複数参照は`referenceCount`へ集約する。

`include_wiki_links`はWikiリンクプラグインの有効状態から渡す。falseの場合はWiki構文の抽出・
解決を行わず、Markdownリンクだけを索引する。リンクタブは無効化せず、Wikiリンクが除外中で
あることを補助表示する。trueの場合は既存バックリンク索引と同じWiki結果を返す。

既存の読込上限に加え、索引・文字列・応答の上限を分離する。

- 文書候補: 10,000件
- 1文書: 10MiB
- 展開後総読込量: 100MiB
- ZIP圧縮データ総量: 100MiB
- 抽出リンク: 100,000件
- 1文書の異なるEdge: 2,000件
- 1索引の異なるEdge: 25,000件
- 1ターゲット: 1,024バイト
- 1文書の保持文字列: 256KiB
- 1索引の保持文字列: 8MiB
- 候補解決検査: 1,000,000件
- 1応答: 各区分500件、シリアライズ後概算1MiB以下
- キャッシュ: 最大4索引、TTL 30秒
- 同時索引構築: 全体1件

いずれかの上限へ達した時点で追加Edgeを保持せず`truncated`を設定する。抽出リンク100,000件は
重複を含む処理量上限であり、25,000件を超える異なるEdgeを索引へ保持しない。応答生成時も
ファイルパス順で各区分500件へ切り詰め、総シリアライズ量が概算1MiBを超える前に停止する。
索引構築が完了している区分は`total = Some(全件数)`、索引自体が上限や読込失敗で打ち切られた
場合は`total = None`とする。`items.len()`との差から省略件数を出すのは`Some`の場合だけとし、
`None`では追加結果の件数を推測しない。

キャッシュキーへ`include_wiki_links`を追加し、その他のwatcher無効化は既存バックリンク仕様を
維持する。Wikiプラグイン設定変更時は異なるキーで再構築する。設定上非表示の文書は一覧の
参照元から除くが、Wikiリンクの解決候補には既存どおり含める。

## 5. フロントエンド

`BacklinksStore`を`LinkInspectorStore`へ置き換え、`outgoing`、`incoming`、`broken`、
`truncated`を保持する。既存のlatest-only、直列キュー、dirty、明示更新処理を維持する。
Wikiプラグイン有効状態を要求scopeとコマンド引数へ含める。

`Sidebar.svelte`の`backlinks`タブを`links`へ移行し、`LinkInspectorPanel.svelte`を表示する。
パネル内はボタンまたはタブリストで「出力」「入力」「問題」を切り替える。選択状態は
セッション永続化せず、初期値を「出力」とする。

リンク項目は`button`として実装し、解決済みの場合だけ開ける。リンク切れは無効ボタンにせず、
詳細を読み上げられるフォーカス可能な項目として表示する。各区分は最大500件だけをDOMへ
描画する。`total`が`Some`なら正確な省略件数、`None`なら「追加結果が省略されている可能性」
を表示する。

## 6. ローカルリンクグラフ

`LinkGraphDialog.svelte`を新設し、サイドバーのグラフボタンから開く。既存Lightboxは画像・SVGの
拡大表示責務に限定されているため拡張しない。

SVG内の配置は決定的な3列レイアウトとする。

- 左列: 入力のみ
- 中央: 現在文書
- 右列: 出力のみとリンク切れ
- 入出力両方: 中央寄りの共有列に1ノード

表示ノードはファイルパスの大文字小文字無視昇順で安定化し、最大40件までとする。
全区分の`total`が`Some`で、かつ`total == items.len()`、すなわち全Edgeが応答内にある場合だけ、
DocumentRef単位の統合後ノード総数をフロントで正確に計算し、40件との差を省略ノード数として
表示する。いずれかの区分が索引打切り、500件上限、1MiB上限で完全でない場合は、Edge総数から
ノード数を推測せず「追加ノードあり（件数不明）」と表示する。破線枠はリンク切れ、エッジの線種またはラベルで
Wiki／Markdownを区別する。

SVGだけに操作を閉じず、同じノードをDOMのボタン一覧として提供する。ダイアログは
`role="dialog"`、`aria-modal="true"`、初期フォーカス、フォーカストラップ、`Escape`、
フォーカス復帰を実装する。

## 7. 安全性

- Source IDとDocumentRefをRust側SourceRegistryで再検証する
- NativeSourceは最終ファイルハンドルパスとAllowedRootsを既存経路で確認する
- ZipSourceは検証済み中央ディレクトリと圧縮・展開上限を使用する
- 信頼ルート外リンクやSource外リンクを索引結果へ含めない
- 生のMarkdown、HTML、絶対ネイティブパスをグラフへ渡さない
- ノードラベルはSvelteのテキスト補間で描画し、`{@html}`を使用しない
- 上限到達時はfail-openで走査を継続せず、部分結果と`truncated`を返す
- Edge本体を索引内で一重化し、IPC応答とDOM表示にも独立した件数・バイト上限を適用する

## 8. 検証

- WikiリンクとMarkdownリンクの抽出・除外・解決単体テスト
- Native/ZIP、隠しファイル、gitignore、generation、TTL、force refreshのRustテスト
- 100,000件の異なるリンク切れ・長いanchorを含む入力で索引・文字列・応答上限を確認する負荷テスト
- 全Edge応答時の正確な省略ノード数と、区分打切り時の件数不明表示を確認するテスト
- 既存バックリンク結果との互換テスト
- Wikiプラグイン無効時にMarkdownだけを返し、有効化後に別キャッシュでWikiを含めるテスト
- LinkInspectorStoreのlatest-only・dirty・エラー処理テスト
- パネルの空・失敗・省略・リンク切れ・キーボード操作テスト
- グラフの配置、40件上限、ノード統合、リンク切れ、フォーカストラップのテスト
- WebView2で一覧遷移、モーダル、`Escape`、ノード遷移を確認する
