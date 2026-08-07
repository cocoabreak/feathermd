# 要求定義: Callouts (callouts)

## 背景・動機

FeatherMDはGitHub Alertsの基本5種をHTMLへ変換できるが、専用スタイルがなく、Obsidian Calloutsの代表種別や折りたたみ記法には対応していない。通常の引用と視覚・意味の両面で区別しつつ、既存のMarkdown処理、サニタイズ、テーマ、出力機能と共存させる。

関連:

- [Issue #23: GitHub Alerts／Obsidian Callouts形式の表示に対応する](https://github.com/cocoabreak/feathermd/issues/23)
- [レンダラープラグイン要求](../renderer-plugins/requirements.md)
- [エクスポート要求](../export-document/requirements.md)
- [カスタムCSS要求](../custom-css/requirements.md)

## スコープ

- **対象**: GitHub Alerts 5種、代表的なObsidian Callout種別と別名、カスタムタイトル、折りたたみ、入れ子、専用スタイル、印刷・HTML出力、カスタムCSS
- **対象外**: ユーザー定義種別・アイコン・色、外部アイコン取得、折りたたみ状態の永続化、Callout単位の設定UI、独自HTMLテンプレート

## ユーザーストーリー

### US-001: GitHub AlertsとObsidian Calloutsの表示

As a Markdown文書の閲覧者
I want to Calloutを通常の引用と区別して表示したい
So that 注意事項や補足を流し読みでも把握できる

**受け入れ条件**

- [x] `NOTE`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION`を大文字小文字を区別せず表示できる
- [x] `ABSTRACT`、`INFO`、`TODO`、`SUCCESS`、`QUESTION`、`FAILURE`、`DANGER`、`BUG`、`EXAMPLE`、`QUOTE`を表示できる
- [x] Obsidianの代表的な別名を正規種別へ対応付ける
- [x] 未対応種別や不正なマーカーは通常の引用として表示する
- [x] 種別ごとの色とアプリ内SVGアイコンを表示し、外部リソースを取得しない

### US-002: タイトルと折りたたみ

As a 長文の閲覧者
I want to Calloutへタイトルと初期折りたたみ状態を指定したい
So that 情報量を抑えながら必要な箇所だけ読める

**受け入れ条件**

- [x] `[!type] Title` のTitleをインラインMarkdownとして表示できる
- [x] タイトル省略時は正規種別の既定英語名を表示する
- [x] `[!type]+` は展開状態、`[!type]-` は折りたたみ状態のネイティブ`details`として表示する
- [x] `+` / `-`なしは常時展開のCalloutとして表示する
- [x] ユーザーによる開閉は現在のDOMに反映するが、再読込・再起動後へ永続化しない
- [x] キーボードとスクリーンリーダーから折りたたみを操作できる

### US-003: Callout内部のMarkdown

As a 文書作成者
I want to Callout内で通常のMarkdown機能を使いたい
So that 補足内にも構造化された情報を置ける

**受け入れ条件**

- [x] 段落、強調、リスト、リンク、画像、コードブロックを既存経路で描画する
- [x] Wikiリンクや既存レンダラープラグインをCallout内部でも利用できる
- [x] Calloutを最大4段まで入れ子表示できる
- [x] 1文書で変換するCalloutは最大256個とし、超過分は通常の引用として表示する
- [x] 256文字を超えるカスタムタイトルはCalloutへ変換せず、通常の引用として表示する

### US-004: 表示・出力・カスタマイズとの共存

As a FeatherMDユーザー
I want to Calloutを通常表示と出力で一貫して利用したい
So that 閲覧環境を変えても情報を失わない

**受け入れ条件**

- [x] ライト・ダークテーマで種別と本文を判読できる
- [x] 印刷/PDFでは折りたたみ状態にかかわらず本文を出力する
- [x] 単一HTML出力へCalloutの構造と必要なアプリ内CSSを含める
- [x] Callout用クラスを`.markdown-body`配下へ限定し、カスタムCSSで上書きできる
- [x] 通常の引用、脚注、定義リストの既存表示を維持する

## 安全性・非機能要求

- Callout変換後のHTMLも既存のDOMPurify処理を必ず通す
- タイトル内のHTML、リンク、画像を既存のMarkdown・サニタイズ・外部画像保護経路から迂回させない
- SVGアイコンは固定文字列だけを使用し、種別・タイトル等の入力をSVG属性やパスへ埋め込まない
- 任意HTML、スクリプト、イベント属性、外部アイコンURLをCallout機能から生成しない
- 上限超過や解析不能時は例外で本文全体を失敗させず、通常の引用へフォールバックする
- 既存の大容量文書上限とセーフモードを変更しない

## 未決定事項（設計フェーズで決定）

- [x] 対応種別と別名
- [x] 折りたたみ記法と状態の永続化
- [x] 入れ子深度、個数、タイトル長の上限
- [x] アイコンと色の供給方法
- [x] 印刷時の折りたたみ本文の扱い
