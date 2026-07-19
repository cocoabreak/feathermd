# 技術設計: 多言語対応 (i18n)

## ステータス

完了

## 全体アーキテクチャ

外部ライブラリを使わず、「ロケール→文字列のRecordを型で縛る」自作方式。
コア・プラグイン・Rustメニューの3層すべてで同じ考え方（言語別辞書+現在ロケールで引く）を貫く。

```
$lib/i18n/
├── index.svelte.ts   # Locale型・i18nストア（現在ロケール$state + 現在辞書getter）
├── ja.ts             # 日本語辞書（Messages型の源）
└── en.ts             # 英語辞書（typeof ja で型を縛る＝キー欠落はコンパイルエラー）
```

## コアの辞書と参照

```ts
// ja.ts — 辞書の形がそのまま型になる（値はstringまたは引数付きフォーマット関数）
export const ja = {
  common: { close: "閉じる", error: "エラー" },
  dialog: { openFileFailed: (path: string, err: unknown) => `ファイルを開けませんでした:\n${path}\n${err}` },
  ...
};

// en.ts — typeof ja で網羅性をコンパイル時に保証
export const en: typeof ja = { ... };

// index.svelte.ts
export type Locale = "ja" | "en";
export type LanguageSetting = "system" | Locale;
i18n.locale   // 現在ロケール（$state）
i18n.m        // 現在言語の辞書（getterで locale を読むためリアクティブ）
```

コンポーネントからは `i18n.m.settings.title` のように参照する。getterが `$state` の
localeを読むため、テンプレート・`$derived` 内での参照は言語切替で自動再描画される。

## 言語設定と切替の流れ

- `Settings.language: "system" | "ja" | "en"`（デフォルト `"system"`、settings.jsonに永続化）
- 実効ロケール解決: `system` → `navigator.language` が `ja` 始まりなら ja、それ以外 en
- `settingsStore.setLanguage()` が実効ロケールを `i18n.setLocale()` に反映
- `loadSettings()`（起動時）と設定パネルの言語select変更時に適用。パネル変更時はさらに
  `set_menu_language` コマンドでネイティブメニューを再構築
- 表示中コンテンツ内のプラグイン由来文言: MarkdownViewerのレンダリングeffectが
  `i18n.locale` を依存に持ち、言語切替で再レンダリング→postRender再実行される

## ネイティブメニュー（Rust側辞書）

- `menu.rs` に ja/en のラベル辞書（`struct MenuLabels` ×2）を持ち、`build_menu(app, locale)` 化
- **起動時**: `setup` 内で `tauri_plugin_store::StoreExt` により settings.json の
  `settings.language` を読む。`"ja"`/`"en"` ならそれを、`"system"`・未設定なら
  `sys-locale` クレートでOSロケールを判定（`ja` 始まり→ja）。起動直後から正しい言語で表示される
- **切替時**: `set_menu_language(locale)` コマンドがメニューを再構築して `app.set_menu()`
- メニューIDは変更しない（`menu-action` イベント→コマンドレジストリの経路は言語非依存）

## プラグインの多言語対応（自己完結の維持）

```ts
// plugins/types.ts
export type LocalizedText = Record<Locale, string>;
displayName: LocalizedText;   // 例: { ja: "Wikiリンク", en: "Wiki links" }
description: LocalizedText;
// PostRenderContext に locale: Locale を追加（コアが注入。ストア直importは引き続き不要）
```

- 設定パネルは `plugin.displayName[i18n.locale]` で表示
- 実行時文言（Mermaidエラー・wiki-links未解決ツールチップ）は各プラグイン内の
  ローカル辞書を `context.locale` で引く。中央辞書（`$lib/i18n/ja.ts`）には載せない
- `plugins.test.ts` の契約テストに「displayName/descriptionがja/en両方を持つ」を追加

## 対象外の明確化

- Rustコマンドのエラー文字列（`Err(String)`）は日本語のまま。UIダイアログの枠
  （タイトル「エラー」等）は翻訳し、`詳細:` 以下に生メッセージを流す現行構造を維持
- `console.*` ログ・コード内コメントは開発者向けのため日本語のまま

## 代替案の比較

| 案 | 判断 |
|---|---|
| 自作の型付き辞書 | **採用**。依存ゼロ・`typeof ja` でキー網羅をコンパイル時保証・プラグイン自己完結と両立 |
| Paraglide JS (inlang) | 不採用。型安全・ツリーシェイキングは魅力だが、メッセージが中央JSONに集約されるためプラグインの自己完結が崩れる。inlang設定+Viteプラグインの構成増も2言語150文言規模では割に合わない |
| svelte-i18n | 不採用。文字列キーで型安全性が弱く、ランタイム依存が増える |
| メニューラベルのフロント注入 | 不採用。起動直後にデフォルト言語のメニューが一瞬見える。Rust側辞書は項目数が少なく管理コスト小 |
