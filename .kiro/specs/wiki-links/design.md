# 技術設計: Wikiリンク

## ステータス

完了

## 全体アーキテクチャ

renderer-pluginsで導入したプラグイン機構に `plugins/wiki-links/` として実装する。
コアのリンククリック処理（`MarkdownViewer.svelte` の `handleClick`）は**変更しない**。
Wikiリンクは解決後に通常のローカルファイルリンク（hrefに実パス）へ変換されるため、
既存のクリック処理・信頼境界確認・アンカースクロール機構がそのまま機能する。

```
フェーズ1（extendMarkdownIt / 同期）
  [[ページ名#見出し|表示]] → <a class="wiki-link" data-wiki-target="ページ名" data-wiki-hash="見出し">表示</a>
  ※この時点ではhrefなし。[[#見出し]] のみ即 href="#見出し" を付与（同一ファイル内アンカー）

フェーズ2（postRender / 非同期）
  1. コンテナ内の a.wiki-link[data-wiki-target] を収集
  2. resolve_wiki_links コマンドで対象名を一括解決（1レンダリングにつきRust呼び出し1回）
  3. 解決成功 → href="実パス(#見出し)" を書き込み（以降は既存のhandleClickが処理する）
     解決失敗 → .wiki-link-missing クラス + title="リンク先が見つかりません"（href無し=クリック不能）
```

## パース（markdown-it inlineルール）

- `md.inline.ruler.before("link", "wiki_link", ...)` で `[[` を検出。`]]` まで（改行・ネスト `[[` を含む場合は不成立）
- 内部書式: `ターゲット(#見出し)?(|エイリアス)?`（Obsidianと同順）
- インラインコード（backticksルールが先行）・コードブロック（fence）内は構造上パースされない
- 属性値のエスケープはmarkdown-itのデフォルトレンダラー（`renderToken`）に任せる

## リンク解決（Rust: `commands/wiki.rs`）

```rust
resolve_wiki_links(
    current_file: String,        // 表示中ファイルの絶対パス
    targets: Vec<String>,        // 解決するページ名のリスト（重複除去済み）
    root: Option<String>,        // エクスプローラーのルート。Noneならcurrent_fileの親フォルダ
    respect_gitignore: bool,
) -> HashMap<String, Option<String>>  // ページ名 → 解決パス（見つからなければNone）
```

- 探索起点は `root`（未指定なら現在ファイルの親フォルダ）。**AllowedRootsで検証**し、信頼範囲外なら拒否。
  したがって解決結果も必ず信頼範囲内であり、クリック時の `is_path_allowed` を通過する
- `ignore` クレートで探索起点以下を再帰走査し、`.md`/`.markdown` のみ収集（`respect_gitignore` はツリーと同じフラグ構成）。
  Wikiリンクを含むドキュメントの表示時のみ実行されるため、含まないファイルの表示コストはゼロ
- **マッチング**（大文字小文字無視）:
  - ページ名に `/` を含まない場合: ファイル名の拡張子除去部（stem）と一致。拡張子付き指定はファイル名全体と一致
  - `/` を含む場合: パスのコンポーネント境界での末尾一致（例: `[[guide/setup]]` は `**/guide/setup.md` にマッチ）
- **同名複数時の優先順位**: ①現在ファイルのフォルダとの共通パス接頭辞が長い順（=近い順、Obsidian互換）
  ②パス階層が浅い順 ③パス文字列昇順。決定的に1件を返す

## プラグインインターフェースの拡張: PostRenderContext

解決には「現在ファイル・ルート・respectGitignore設定」が必要だが、プラグインからストアを直接importする規約違反を避けるため、`postRender` の第2引数としてコアが注入する:

```ts
export interface PostRenderContext {
  filePath: string | null;      // 表示中ファイルの絶対パス
  rootPath: string | null;      // エクスプローラーのルート（未設定ならnull）
  respectGitignore: boolean;
}
postRender?(container: HTMLElement, context: PostRenderContext): (() => void) | void;
```

既存プラグイン（Mermaid）は第2引数を使わないため変更不要。`MarkdownViewer.svelte` は
コンテキスト値を `untrack` で読み、DOM後処理エフェクトに不要な依存を追加しない。

## スタイル

- 通常時: 既存の `.markdown-body a` スタイル（青リンク）がhref有無に関わらず適用されるため追加不要
- 未解決時: プラグインが `<style>` を一度だけ `document.head` に注入する（プラグイン自己完結のため）。
  `.markdown-body a.wiki-link.wiki-link-missing { グレー・下線なし・カーソルdefault }`

## セキュリティ

- 探索起点をAllowedRootsで検証するため、Wikiリンク経由で信頼範囲外のファイルは解決されない
- パース時はhrefを付与しない（`E:/...` のような絶対パスhrefはDOMPurifyのURIスキーム検査で
  剥がされるため、sanitize後のDOMに対してpostRenderで付与する構成が必然でもある）
- 表示テキスト・属性値はmarkdown-itのレンダラーがエスケープする

## 代替案の比較

| 案 | 判断 |
|---|---|
| postRenderで解決しhrefへ書き込み、クリックは既存機構に委譲 | **採用**。コア変更が最小で信頼境界チェックも再利用 |
| クリック時にその場で解決（handleClickにwikiスキーム分岐を追加） | 不採用。コアがwiki-links固有の知識を持つ＋未解決リンクのグレーアウトに結局事前解決が必要 |
| フロントのエクスプローラーツリーから解決 | 不採用。遅延読み込み化により未展開フォルダのファイルがツリーに存在しない |
