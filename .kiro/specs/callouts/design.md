# 技術設計: Callouts (callouts)

## ステータス

実装・検証・レビュー完了

## 1. 設計方針

既存の`markdown-dialects`プラグイン内にCallout専用のmarkdown-it core ruleを実装する。blockquoteとしてパース済みのtoken列から先頭マーカーを認識し、対応するopen/close tokenだけを`aside`または`details`へ変換する。本文tokenは作り直さないため、Wikiリンク、画像、コードブロック、他のレンダラープラグインを既存経路のまま利用できる。

現在の`markdown-it-github-alerts`はGitHub 5種とタイトル生成だけを担い、折りたたみ・上限・代表的なObsidian種別を一体で扱えないため削除する。追加依存は導入しない。

```text
Markdown blockquote
  -> markdown-it block parse
  -> callout core rule（既知マーカー・上限判定）
  -> aside/details tokenへ変換
  -> 通常のinline/fence/plugin処理
  -> DOMPurify
  -> .markdown-body内へ挿入
```

## 2. 対応記法

```markdown
> [!NOTE]
> Body

> [!TIP] Custom *title*
> Body

> [!QUESTION]- Initially closed
> Hidden until opened

> [!EXAMPLE]+ Initially open
> Visible and collapsible
```

`+`は初期展開、`-`は初期折りたたみ、指定なしは折りたたみ不可とする。状態はMarkdownソースを初期値とし、ユーザー操作後の`open`状態をsettingsやsessionへ保存しない。

### 2.1 正規種別

| 正規種別 | 既定タイトル | 別名 |
| --- | --- | --- |
| `note` | Note | - |
| `abstract` | Abstract | `summary`, `tldr` |
| `info` | Info | - |
| `todo` | Todo | - |
| `tip` | Tip | `hint` |
| `important` | Important | - |
| `success` | Success | `check`, `done` |
| `question` | Question | `help`, `faq` |
| `warning` | Warning | - |
| `caution` | Caution | - |
| `failure` | Failure | `fail`, `missing` |
| `danger` | Danger | `error` |
| `bug` | Bug | - |
| `example` | Example | - |
| `quote` | Quote | `cite` |

種別はASCII英数字と`_`/`-`だけを候補として大文字小文字を区別せず解析し、上表にない種別は通常のblockquoteとして残す。

## 3. token変換

`callouts.ts`が`md.core.ruler.after("block", "callouts", ...)`を登録する。

1. token列を1回だけ走査し、`blockquote_open` / `blockquote_close`をtagまたはnullだけのstackで対応付ける
2. 各`blockquote_open`の直後にある直接の先頭inline tokenだけを調べる
3. `[!type]`、任意の`+`/`-`、同一行のタイトルを解析する
4. 既知種別、深度4以下、変換数256以下、タイトル256文字以下の場合だけ変換する
5. 通常Calloutは`aside.callout`、折りたたみCalloutは`details.callout`へ変換する
6. マーカーだけの空paragraphはhidden tokenとして出力から除外する

open tokenの`meta`には固定化した正規種別、既定または入力タイトル、折りたたみ種別だけを保持する。クラス名、色、SVG選択へ生の種別を使わない。

タイトルは`md.renderInline()`でインラインMarkdownとして描画し、文書全体の最終HTMLと同じDOMPurify処理へ通す。生HTML、危険URL、イベント属性を別経路で許可しない。

解析やrenderer ruleが失敗した場合は対象blockquoteを変更せず、通常の引用へフォールバックする。

## 4. HTML構造

通常Callout:

```html
<aside class="callout callout-note" data-callout="note">
  <div class="callout-title">
    <span class="callout-icon" aria-hidden="true"><svg>...</svg></span>
    <span class="callout-title-text">Note</span>
  </div>
  <p>Body</p>
</aside>
```

折りたたみCallout:

```html
<details class="callout callout-question" data-callout="question">
  <summary class="callout-title">...</summary>
  <p>Body</p>
</details>
```

`details` / `summary`のネイティブ操作とアクセシビリティを利用し、独自click handlerやARIA状態同期を持たない。SVGは固定の`viewBox`とpathだけを生成し、外部URLや入力値を含めない。

## 5. スタイルとテーマ

`styles.ts`の固定文字列に`.markdown-body .callout...`を定義する。`markdown-dialects`の`postRender`はCalloutが存在する場合だけ、この文字列を`style.textContent`としてカスタムCSSより前へ1回だけ挿入する。HTML出力も同じ固定文字列を埋め込み、アプリ表示と出力の差異・重複を避ける。

- 基本構造: 左ボーダー、薄い背景、余白、角丸
- 種別: CSS変数`--callout-color`を正規種別ごとに設定
- タイトル: アイコンとテキストをflex配置
- 入れ子: 親幅を超えず、既存本文余白と整合
- 折りたたみ: summaryの標準マーカーを維持し、キーボード操作を阻害しない
- ダークテーマ: HSL色と透過背景を使い、テーマ変数と共存
- カスタムCSS: アプリの基本styleより後に注入される既存順序を維持する

`@media print`では閉じた`details.callout`のsummary以外も表示し、印刷/PDFで本文を失わない。単一HTML出力は現在の`.markdown-body` HTMLとアプリ内styleを収集する既存実装を利用する。

## 6. 上限とフォールバック

- Callout入れ子深度: 4
- 変換数: 1文書256個
- カスタムタイトル: 256 Unicode code point
- 文書・本文サイズ: 既存のMarkdown読込上限とセーフモードを利用

上限を超えた要素だけを通常のblockquoteとして残す。全blockquoteのrange配列やsortは作らず、補助メモリを入れ子深度のstackだけに限定する。Calloutのために本文を複製せず、個数に比例したイベントリスナーや永続化データを作らない。

## 7. テスト戦略

### ユニットテスト

- GitHub 5種、Obsidian正規種別、別名、大文字小文字
- 既定タイトル、カスタムタイトル、インラインMarkdown、危険HTMLのsanitize
- 常時展開、初期展開、初期折りたたみのHTML構造
- 段落、リスト、Wikiリンク、画像、コードブロック、入れ子
- 未知種別、不正記法、深度5、257個、257文字タイトルのblockquoteフォールバック
- 固定SVGに外部URL・ユーザー入力が含まれないこと
- Callout style、ダークテーマ、印刷展開規則
- 脚注・定義リスト・通常blockquoteの回帰

### 実アプリ

検証中は各種別、別名、折りたたみ、入れ子、内部Markdown、sanitize probeをまとめた一時Markdownを使用する。最終レビュー後、代表的な永続ケースだけを`samples/markdown-compatibility.md`へ統合し、網羅用の一時ファイルはコミットから除外する。

## 8. 決定事項

- `markdown-dialects`内の自前core ruleとし、`markdown-it-github-alerts`依存を削除する
- GitHub 5種と代表的なObsidian 10種・別名を固定対応する
- `+` / `-`はネイティブ`details`、指定なしは`aside`とする
- 開閉状態は永続化しない
- 深度4、256個、タイトル256文字を上限とする
- 固定のアプリ内SVGとCSSだけを使用する
- 印刷では折りたたみ本文を常に出力する
