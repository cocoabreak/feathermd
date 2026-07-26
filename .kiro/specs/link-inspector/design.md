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
      /           \
LinkInspectorPanel  Rust LinkGraphWindowState
                              |
                    LinkGraphWindow / Cytoscape.js
```

リンクインスペクターとグラフは同じ`LinkContextResponse`を使用する。リンクグラフは独立した
WebViewウインドウで表示するため、メインウインドウが現在文書と表示条件をRust側の
`LinkGraphWindowState`へ同期し、グラフウインドウは保存済みコンテキストを使って同じ索引を
取得する。グラフ表示のための別索引や本文再走査は行わない。

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

独立ウインドウとの同期には以下の用途限定コマンドを使用する。

- メイン専用: `begin_link_graph_window_context_session`、
  `update_link_graph_window_context`、`open_link_graph_window`、
  `close_link_graph_window`
- リンクグラフ専用: `get_link_graph_window_context`、
  `get_link_graph_data`、`request_link_graph_document_open`

メインWebViewの再読み込みごとにUUIDのセッションを開始し、各更新へ単調なsequenceを付ける。
Rust側が単調な`contextVersion`を発番し、旧セッション、逆順sequence、古い応答を拒否する。
`get_link_graph_data`が返した解決済み入力・出力DocumentRefだけを、そのversionで開ける集合として
Rust側へ保持する。ノード遷移要求はversion、現在文書、Source、許可集合を照合してから
メインウインドウへ通知する。

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
既存の表示時遷移と同じスラッシュ正規化を行い、追加のURLデコードは行わない。受動処理では
NUL、絶対パス、UNC、Sourceルートを越える`..`を拒否する。NativeSourceの絶対パスやSource外
リンクは索引・プレビュー対象にせず、ユーザーがクリックした場合だけ既存の明示確認経路で扱う。
拡張子が`.md`または`.markdown`の同一Source内パスだけを索引する。

解決処理はVirtualPathの正規化とSource内候補集合を用いる。フロントには受動処理専用の
`resolveSourceRelativeMarkdownTarget`を設け、Rust索引と同じ相対パス、バックスラッシュ、
フラグメント、絶対パス、UNC、Sourceルート越え、URI、クエリ、NULの境界値をテストで固定する。
明示クリック用の`resolveDocumentTarget`は絶対パスを確認付き遷移へ渡す既存責務を維持する。

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

`LinkGraphView.svelte`でCytoscape.jsのCanvasグラフを描画し、`LinkGraphWindow.svelte`を
静的ルート`/link-graph`へ表示する。既存Lightboxは画像・SVGの拡大表示責務に限定し、
リンクインスペクター内へ関連文書一覧を重複表示しない。

Rustの`open_link_graph_window`はラベル`link-graph`のWebViewウインドウを1つだけ生成する。
既に存在する場合は新規作成せず、表示、最小化解除、フォーカスを行う。ウインドウは初期
900×650px、最小520×360pxでリサイズ可能とし、メインウインドウのアプリメニューを継承
しないよう生成時と再表示時にメニューを削除する。メインウインドウ終了時はサブウインドウも
閉じる。

グラフウインドウは250ms間隔のsingle-in-flightポーリングでRust側コンテキストを確認する。
`contextVersion`が進んだ場合だけ索引結果を読み込み、要求IDとversionの両方で古い応答を破棄する。
メイン側の文書、テーマ、言語、隠しファイル、gitignore、Wikiリンク設定の変更へ追従する。
明示更新では現在versionの索引を`forceRefresh`付きで再取得する。

Cytoscape.jsは物理シミュレーションを使わない`concentric`レイアウトとする。現在文書を中心、
入力・出力・両方向・リンク切れノードを外周へ配置する。ノードラベルはボックス内へ描画し、
リンク切れは警告記号、赤系色、破線枠で示す。エッジはWikiリンクを破線、Markdownリンクを
実線として方向を表示する。

表示ノードはファイルパスの大文字小文字無視昇順で安定化し、現在文書を含め最大40件までとする。
全区分の`total`が`Some`で、かつ`total == items.len()`、すなわち全Edgeが応答内にある場合だけ、
DocumentRef単位の統合後ノード総数をフロントで正確に計算し、40件との差を省略ノード数として
表示する。いずれかの区分が索引打切り、500件上限、1MiB上限で完全でない場合は、Edge総数から
ノード数を推測せず「追加ノードあり（件数不明）」と表示する。

Canvasを`role="application"`のカスタムキーボードウィジェットとして扱い、矢印キー、
`Home`、`End`でノードを移動し、`Enter`またはSpaceで解決済み文書を開く。選択中ノードは
ARIA live領域へ通知する。ノード選択後もグラフウインドウは閉じず、メイン側の文書切替に
追従して再描画する。

## 7. 安全性

- Source IDとDocumentRefをRust側SourceRegistryで再検証する
- NativeSourceは最終ファイルハンドルパスとAllowedRootsを既存経路で確認する
- ZipSourceは検証済み中央ディレクトリと圧縮・展開上限を使用する
- 信頼ルート外リンクやSource外リンクを索引結果へ含めない
- 生のMarkdown、HTML、絶対ネイティブパスをグラフへ渡さない
- ノードラベルはCytoscapeの`data`からCanvasテキストとして描画し、HTMLや`{@html}`へ
  挿入しない
- `AppManifest::commands`でアプリ内TauriコマンドをACL管理し、メインとリンクグラフの
  capabilityを分離する
- リンクグラフには用途限定の3コマンドだけを許可し、汎用イベント、ファイル読込、履歴、
  外部エディター等の権限を与えない
- 各専用コマンドはRustが注入する`WebviewWindow`のラベルを検証し、フロントから呼出元を
  偽装できないようにする
- グラフからの文書遷移は、Rustが直前に返した解決済みノード集合との完全一致を確認し、
  メイン側でもversion、現在文書、Sourceを再検証する
- 上限到達時は安全側に走査を打ち切り、部分結果と`truncated`を返す
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
- グラフモデルの40件上限、ノード統合、リンク切れと、Canvasのキーボード操作をテストする
- シングルトン生成、文書追従、逆順更新、WebView再読み込み、古いノード遷移拒否、
  メイン終了時のサブウインドウ破棄をテストする
- capability分離と、リンクグラフから未許可コマンド・汎用イベントを利用できないことを確認する
- WebView2でNative/ZIPの一覧遷移、同心円配置、独立ウインドウ、リサイズ、メニュー非表示、
  文書追従、ノード遷移を確認する
