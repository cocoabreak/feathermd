# 技術設計: 読み取り専用ドキュメントソース (document-sources)

## ステータス

実装完了

## 基本方針

汎用ファイルシステムを再現せず、FeatherMDが閲覧に必要とする一覧・Markdown読込・画像読込・
検索・リンク解決・更新通知だけを抽象化する。セキュリティ境界はRust側に置き、フロントエンドは
登録済みソースIDとソース内相対パスだけを扱う。

## 全体構成

```text
Explorer / Tabs / Viewer / Search / Wiki / Images
                       |
                 DocumentRef
              { sourceId, path }
                       |
              Tauri source commands
                       |
                 SourceRegistry
                  /          \
          NativeSource      ZipSource
          AllowedRoots      zip crate
```

レンダラープラグインと異なり、ドキュメントソースはローカルファイルアクセスの信頼境界を持つ。
そのため実行時の自動発見は行わず、Rustバイナリへ静的に組み込む。

## データモデル

### Rust

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRef {
    pub source_id: String,
    pub path: String,
}

pub enum SourceBackend {
    Native(NativeSource),
    Zip(ZipSource),
}

pub struct SourceRegistry {
    sources: Mutex<HashMap<String, Arc<SourceBackend>>>,
}
```

sourceIdはプロセス内だけで有効な連番IDとする。VirtualPathは`/`区切り、先頭`/`なし、
`.`・`..`・空コンポーネント・NULなしの相対パスとする。ルートは空文字列で表す。

### Frontend

```ts
export interface DocumentRef {
  sourceId: string;
  path: string;
}

export interface DocumentSourceInfo {
  id: string;
  kind: "native" | "zip";
  label: string;
  nativePath: string;
  generation: number;
  capabilities: SourceCapabilities;
}

export interface FileEntry {
  name: string;
  document: DocumentRef;
  isDir: boolean;
  isHidden: boolean;
  children?: FileEntry[];
}
```

TabとcontentStoreのキーもDocumentRef由来の安定したキーを使う。文字列化は比較・Mapキー専用の
関数へ閉じ込め、疑似URLとしてパースし直さない。

## Source capabilities

```ts
interface SourceCapabilities {
  watch: "entries" | "container" | "none";
  externalEditor: boolean;
  respectGitignore: boolean;
  fullTextSearch: boolean;
  wikiLinks: boolean;
}
```

| capability | Native | ZIP |
| --- | --- | --- |
| watch | entries | container |
| externalEditor | true | false |
| respectGitignore | true | false |
| fullTextSearch | true | true |
| wikiLinks | true | true |

## 共通操作

v0.1.0では外部crateを増やすasync traitを避け、`SourceBackend`のメソッドでenum dispatchする。

```rust
impl SourceBackend {
    fn list(&self, directory: &VirtualPath, options: ListOptions) -> Result<Vec<SourceEntry>, SourceError>;
    fn read_markdown(&self, path: &VirtualPath) -> Result<MarkdownFileContent, SourceError>;
    fn read_image(&self, path: &VirtualPath) -> Result<ImageContent, SourceError>;
    fn search(&self, query: &SearchQuery) -> Result<Vec<SearchResult>, SourceError>;
    fn resolve(&self, base: &VirtualPath, target: &str) -> Result<VirtualPath, SourceError>;
}
```

Tauri commandは`list_source_entries`、`read_source_markdown`、`read_source_image`、
`search_source`、`resolve_source_wiki_links`を公開する。検索は`spawn_blocking`へ分離し、
一覧・単一読込はTauriのasync commandとして実行する。相対パスの構文解決はフロントの純粋関数で行い、
最終的な一覧・読込時にはRust側でVirtualPathとAllowedRootsを再検証する。

## NativeSource

- 登録時に明示選択されたルートをcanonicalizeし、危険ルート拒否を行う
- 内部にcanonical rootを保持し、VirtualPathを結合した後に既存AllowedRoots検証を通す
- Markdown/CSS/画像の既存サイズ制限と最終ファイルハンドルパス検証を維持する
- `.gitignore`と隠しファイル設定を維持する
- watcherは既存の個別ファイル・展開中ディレクトリ監視をsourceId + VirtualPathイベントへ変換する
- 外部エディター起動時だけ検証済み実パスへ変換する

移行期間は既存commandを互換アダプターとして残し、全呼び出しの移行後に削除する。

## ZipSource

### 登録

1. ユーザーが`.zip`を明示選択する
2. AllowedRootsへZIP本体だけを単一ファイル認可として登録し、親フォルダーへ権限を広げず、最終ファイルハンドルパスを再検証する
3. `zip::ZipArchive`で中央ディレクトリを読む
4. 全エントリのメタデータを検証し、安全なインデックスを構築する
5. 検証成功後だけSourceRegistryへ登録する

`zip`クレートは互換性とバイナリサイズを確認して正確なバージョン・featuresを固定する。
v0.1.0は読込のみで、暗号化機能は有効化しない。

### インデックス

```rust
struct ZipIndexEntry {
    archive_index: usize,
    path: VirtualPath,
    kind: EntryKind,
    compressed_size: u64,
    uncompressed_size: u64,
}
```

- 明示的なディレクトリエントリがなくても親ディレクトリを合成する
- Markdownと対応画像以外のファイルは読込対象にしないが、親ディレクトリ構築には使用する
- 同じ正規化パス、ファイルとディレクトリの衝突、大文字小文字だけ異なる曖昧パスは拒否する
- symlink、絶対パス、ルート外解決、NULを含む名前を拒否する
- ZIP本体を更新した場合はインデックスを再構築し、source generationを更新する

### 読み取り

ディスクへ展開せず、archive indexで対象エントリを開き、`Read::take(limit + 1)`で実読込量を
制限する。ヘッダーのuncompressed_sizeだけを信用しない。MarkdownはUTF-8以外をエラーにする。

## リソース制限

初期値は既存制限との整合と実アプリ計測で確定する。少なくとも以下を定数化する。

| 制限 | 初期方針 |
| --- | --- |
| ZIPファイルサイズ | 1GiB以下 |
| エントリ数 | 10,000以下 |
| Markdown単体 | 10MiB以下（既存と同じ） |
| 画像単体 | 20MiB以下（既存と同じ） |
| 全エントリ宣言展開サイズ合計 | 1GiB以下 |
| 単一エントリ圧縮率 | 1,000倍以下 |
| 検索対象Markdown | 既存全文検索上限を維持 |

0バイト圧縮サイズ、data descriptor、ZIP64等を考慮し、圧縮率だけを唯一の防御にしない。

## パス・リンク・画像

- 相対解決はprovider側の`resolve`で行う
- `..`はZIPルートを越えた時点で拒否する
- `/`始まり、ドライブパス、UNCパスはZIP内リンクとして拒否する
- `http:` / `https:`と同一文書アンカーは既存処理を維持する
- ZIP内Markdownからネイティブファイルへの暗黙リンクは許可しない
- 画像は`read_source_image`からdata URLを返し、既存の外部画像ポリシーとSVG処理を維持する

## Explorer・タブ

- Explorer storeは`rootPath`の代わりに`DocumentSourceInfo`を保持する
- expanded/loadingのキーはDocumentRefの安定キーを使う
- Tabは`path: string`を`document: DocumentRef`へ置換し、表示用パスは別関数で生成する
- ZIP内タブのタイトルはbasename(entry path)、ステータスバーは`archive.zip / entry/path.md`形式で表示する
- externalEditor capabilityがfalseならコンテキストメニュー項目を出さない

## 全文検索・Wikiリンク

- search commandはsourceIdを受け、バックエンドごとに列挙・読込する
- Nativeは既存ignore walker、ZIPは検証済みインデックスを利用する
- 既存の結果総量、キャンセル、latest-only制御を維持する
- Wiki候補キャッシュキーをsourceId + source generation +設定へ変更する

## 監視

Nativeは既存entry watcherを維持する。ZIPはコンテナファイル1件だけを監視する。

```text
archive.zip changed
  -> ZipSource reindex
  -> source-changed { sourceId, generation }
  -> Explorer reload
  -> open tabs reload
  -> missing entries become deleted
```

再インデックス失敗時は直前の安全なインデックスを使い続け、エラー通知する。書き換え途中の一時的な
破損を考慮して既存watcher debounce後に1回だけ短い再試行を行う。既存のファイルパスイベントを
フロントでsourceIdへ対応付け、再登録成功時にsource generationを更新する。

## 履歴・セッション復元

sourceIdは永続化しない。以下のSourceSpecを保存し、復元時にRustへ再登録して新しいIDを得る。

```ts
type SourceSpec =
  | { kind: "native"; nativePath: string }
  | { kind: "zip"; nativePath: string };
```

TabはSourceSpecへの参照とVirtualPathを保存する。保存済み入力は信頼済みとはみなさず、既存の
起動時入力登録・永続信頼方針と同等のRust側検証を通す。

## エラー分離

v0.1.0ではTauri commandの既存契約に合わせて利用者向け文字列エラーを返し、ソース全体の登録・再読込失敗と
単一エントリの読込失敗を呼び出し箇所で分けて扱う。構造化`SourceError`はバックエンド追加時に導入する。
1ソースの失敗で他ソースのタブや保存状態を破棄しない。

## 将来バックエンド

- SevenZipSource: solid block単位の復号・キャッシュが必要
- TarSource: tar indexと圧縮ストリームの再走査またはキャッシュが必要
- TarGzip/TarZstdはTarSourceの入力decoder差として扱う

共通APIは同じだが、性能特性を隠して無制限キャッシュを行わない。必要になった時点で個別specを作る。
