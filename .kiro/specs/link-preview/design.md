# 技術設計: ローカルリンク先のホバープレビュー

## ステータス

設計完了

## 1. 全体構成

MarkdownViewerのDOM後処理として対象リンクへイベントを設定し、解決済み`DocumentRef`を
プレビューStoreへ渡す。リンク索引全体は要求せず、対象文書の先頭だけをRust側で制限読込する。

```text
MarkdownViewer内のローカルリンク
          |
 setupLinkPreviewTrigger
   450ms / focus
          |
 LinkPreviewStore (latest-only + 最大32件キャッシュ)
          |
 read_source_link_preview (最大256KiB)
          |
 extractFrontmatter + プレーンテキスト抜粋
          |
 LinkPreviewPopover
```

Wikiリンクはプラグインの`postRender`開始時に、モジュール内の
`WeakMap<HTMLAnchorElement, LinkTargetState>`へ`pending`を登録する。解決後は`href`を設定して
`resolved(DocumentRef)`、未解決なら`missing`へ遷移する。Source IDやDocumentRefをDOM属性へ
保存しない。Markdownリンクは信頼済みの`PostRenderContext`と既存
`resolveDocumentTarget`から`DocumentRef`を得る。

```ts
type LinkTargetState =
  | { status: "pending" }
  | { status: "resolved"; document: DocumentRef }
  | { status: "missing" };
```

同じモジュールは`watchLinkTarget(anchor, callback)`を提供し、購読者を別のWeakMapへ保持する。
Wikiプラグインだけが状態更新関数を呼び、更新時に現在の購読者へ通知する。生HTMLやDOMイベントを
状態更新経路として扱わない。ホバー／フォーカスが解決前に始まった場合、450ms後はloadingを表示し、
滞在中に`resolved`または`missing`へ変わると新しいpointer／focusイベントなしでStoreを更新する。
起点から離れた場合とMarkdown再レンダリング時は購読を解除し、plugin cleanup後の通知を無視する。

## 2. 制限付き読込コマンド

新規Tauriコマンド:

```rust
#[serde(rename_all = "camelCase")]
enum LinkPreviewReadResponse {
    Ready {
        raw_prefix: String,
        byte_size: u64,
        truncated: bool,
    },
    Missing,
}

read_source_link_preview(
    current: DocumentRef,
    target: DocumentRef,
) -> LinkPreviewReadResponse
```

Rust側で`current.source_id == target.source_id`を必須とし、両方をSourceRegistryで検証する。
WebViewから別Source ID、偽造パス、存在しないSourceを渡した場合は読込前に拒否する。
同一Source内で正規化済み対象文書が存在しない場合だけ`Missing`を返す。AllowedRoots違反、
危険なZIP entry、UTF-8不正、非Markdown、ロック失敗などは`Err`とし、フロントでは共通の
安全なエラー表示へ変換する。エラー文字列からmissingを判定しない。

最大読込量は256KiBとする。NativeSourceは`open_allowed_file`で最終パスを再検証し、
`Read::take(limit + 1)`で読む。ZipSourceは検証済みentryを使用し、宣言サイズ、圧縮率、
実展開量、UTF-8を既存読込と同じ方針で検証する。

UTF-8コードポイント途中で上限へ達した場合は末尾の不完全なバイト列だけを除外し、
`truncated = true`とする。文書全体が10MiB上限を超える場合もプレビュー読込量は256KiBを
越えないが、既存の危険なZIP entryや非Markdown文書は拒否する。

## 3. プレビュー抽出

フロントエンドで既存`extractFrontmatter`を再利用する。表示対象は型検証済みの以下だけとする。

- `title`: 文字列
- `aliases`: 文字列または文字列配列
- `tags`: 文字列または文字列配列

表示前に次の上限を適用する。

- `title`: Unicodeコードポイント256文字
- `aliases`、`tags`: 各32件
- 各配列要素: Unicodeコードポイント256文字
- 表示メタデータ総量: UTF-8で8KiB

文字列はコードポイント境界で切り詰め、配列件数または総量を超えた分は保持・描画せず
「ほかN件」または件数不明の省略表示にする。型不一致の値とネストした配列・オブジェクトは
表示対象へ変換せず無視する。

抜粋抽出は専用の純粋関数`extractLinkPreview`へ分離する。

1. frontmatterを除去する
2. 指定見出しがあれば既存と同じslug規則で見出しを探索する
3. 見出し直後、または文書冒頭からコードブロック、HTML、画像を除外する
4. Markdownのインライン記号をプレーンテキスト化する
5. 空白を正規化して最大320文字へ切り詰める

HTMLレンダリング、`{@html}`、Mermaid、KaTeX、Shiki、外部画像読込は実行しない。
対象見出しが256KiBの範囲に存在せず`truncated`の場合は、文書冒頭へ代替せず
「見出しはプレビュー範囲外です」と表示する。

## 4. DOMイベント

`setupLinkPreviewTrigger(container, context)`は対象`a`へ個別リスナーを増やさず、
コンテナの`pointerover`、`pointerout`、`focusin`、`focusout`を委譲で処理する。
cleanupでタイマーとリスナーを必ず解除する。

対象判定:

- `a.wiki-link`で信頼済みWeakMapに`pending | resolved | missing`状態がある
- 外部URL、同一文書アンカー、画像リンクではないMarkdownリンク
- 同一DocumentSource内の`.md`または`.markdown`

ポインター表示タイマーは450ms、非表示タイマーは150ms。リンクからポップオーバーへの移動は
`relatedTarget`とStoreのアンカーIDで判定する。キーボード操作では起点リンクにフォーカスを
維持する。新しいリンクを対象にした時点でrequest IDを更新し、古いinvoke結果を破棄する。

## 5. Storeとキャッシュ

`LinkPreviewStore`は以下を保持する。

- 対象DocumentRef、anchor、起点要素の`DOMRect`
- `idle | waiting | loading | ready | missing | error`
- 表示用タイトル、パス、見出し、抜粋、aliases、tags
- request IDと表示・非表示タイマー

キャッシュキーは`source.id + generation + document.path`。同じ文書の別見出しは最大256KiBの
読込結果を共有し、抜粋だけを再計算する。派生メタデータは上記の件数・8KiB上限を適用した
結果だけを保持する。最大32件のLRUとし、永続化しない。watcherイベント、Source generation変更、
文書削除で該当Sourceのキャッシュを破棄する。

## 6. ポップオーバー

`LinkPreviewPopover.svelte`を`+page.svelte`直下へ1個だけ配置する。`position: fixed`で
起点リンクの下側を優先し、収まらない場合は上側へ反転する。左右は8pxのビューポート余白内へ
クランプする。スクロールとresize時に位置を更新する。

ポップオーバーは操作要素を持たない非モーダルな`role="tooltip"`とし、起点リンクの
`aria-describedby`から関連付ける。キーボード起点でもフォーカスはリンクへ維持し、
`Escape`でプレビューだけを閉じる。ポインター起点でもフォーカスを奪わない。

すべての文書由来値をSvelteのテキスト補間で描画する。相対パスは表示だけに使い、
クリック時の遷移は元リンクの既存処理へ委譲する。

## 7. エラーと競合

- 450ms前に離脱: invokeしない
- 読込中に別リンクへ移動: 古い結果を破棄
- Source generation変更: キャッシュ無効化後に再読込
- 解決済みWikiリンク切れ: invokeせずmissing表示
- 解決中Wikiリンク: loading表示とレジストリ購読を行い、離脱時に購読解除
- 存在しないMarkdownリンク: 構造化された`Missing`をmissing表示へ変換
- 読込・UTF-8・ZIP検証失敗: 詳細な内部パスを出さずerror表示
- 起点要素がDOMから消えた: ポップオーバーを閉じる
- 文書再レンダリング: cleanup後に新しいコンテナ状態へ再設定

## 8. 安全性

- DocumentRefをRust側SourceRegistryで再検証する
- currentとtargetのSource ID一致をRust側でfail-closedに検証する
- WikiリンクのDocumentRefはWeakMapへ保持し、偽造可能なDOM属性を信頼しない
- レジストリ状態更新はモジュール関数だけに閉じ、DOMイベントのdetailを信頼しない
- NativeのAllowedRoots、最終ファイルハンドル、Zipの検証済みentryを再利用する
- 256KiBを実読込量で強制し、宣言サイズだけを信用しない
- Markdown・frontmatter値をHTMLとして挿入しない
- 外部URL、外部画像、スクリプト、SVGを取得・実行しない
- エラーへ絶対ネイティブパスや生本文を含めない
- キャッシュ件数を制限し、Source更新後の古い内容を再利用しない

## 9. 検証

- 256KiB境界、UTF-8境界、Native/ZIP、危険entry、非MarkdownのRustテスト
- Missingと検証エラーが文字列解析なしで分離されるRust／Storeテスト
- frontmatter型検証、見出し探索、Markdown除去、320文字上限の単体テスト
- 巨大title、数万件のaliases／tags、巨大要素、型不一致で件数・8KiB上限を確認する負荷テスト
- 450ms／150msタイマー、latest-only、LRU、無効化のStoreテスト
- pointer／focus／Escape／関連ターゲット／cleanupのDOMテスト
- hover／focus中にWiki状態がpendingからresolved／missingへ変わる競合テスト
- 生HTMLで偽造したclass・data属性・別Source IDからプレビュー読込できないことの境界テスト
- ポップオーバー位置反転・クランプ・アクセシビリティのコンポーネントテスト
- WebView2でWiki／Markdown、見出し、リンク切れ、キーボード操作を確認する
