# ADR-010: KaTeX を ESM ビルドに解決させ Rolldown のバンドル破壊を回避する

- **Date**: 2026-07-08
- **Status**: Accepted

## コンテキスト

数式レンダリングは markdown-it + `@traptitech/markdown-it-katex` + KaTeX で行っている。Vite 8（Rolldown/Oxc ベースの新バンドラー、ADR-008後の依存更新で導入）へ移行した後、**`\frac` `\sum` `\int` など「バックスラッシュ・コマンド」を含む数式が描画されなくなる**不具合が発生した。**dev（`tauri dev`）と release build の両方で発生する。**

- 症状: `\frac{1}{2}` が `rac12` のように化ける（`\f` がフォームフィード(0x0C)として扱われ、KaTeX が「Unexpected character '\f'」で失敗、または該当コマンドが脱落する）。
- 一方、`E=mc^2` や `\sqrt` など単純な式・コマンドは正しく描画される。インライン `$...$`・ブロック `$$...$$` の両方で発生。

当初は KaTeX のバージョン不整合（`katex@0.17.0` を `^0.17.0` で取得。プラグインの peer は `^0.16.0`）を疑ったが、切り分けの結果それは誤診だった。

## 調査と根本原因

段階的な切り分けで、原因はバンドラー（Vite 8 / Rolldown）にあると特定した。

| 検証 | 結果 |
|---|---|
| ファイルのバイト列・Rust `read_file` の返す文字列 | `\frac` はリテラルで正しい（フォームフィード混入なし） |
| **KaTeX 単体を Node で** `renderToString("\frac{1}{2}")` | **正常**（0.16.47・0.17.0 とも `<mfrac>` 生成） |
| **プラグイン + KaTeX を Node で（未バンドル）** | **正常** |
| 素の markdown-it（プラグインなし） | `\frac` をリテラル保持・破壊なし |
| **実アプリ（Rolldown バンドル済み: dev・release とも）** | **破壊**（`rac12` / `\f`エラー） |

→ **同一のコード・同一の入力が、Node（未バンドル）では正常／Rolldown バンドル後だけ壊れる**。差分はバンドラーのみ。

発生経路:
- `@traptitech/markdown-it-katex` は CommonJS で `require('katex')` する。KaTeX の exports は `require` 条件で **UMD 版 `dist/katex.js`**（webpack 製の minified バンドル）に解決される。
- Rolldown はこの UMD を CommonJS 互換シム経由で再バンドルする。その過程で KaTeX 内部の文字列（エスケープを含むパーサ用テーブル等）が壊れ、`\f` 等の扱いが変わる。
- さらに **dev の `optimizeDeps`（依存事前バンドル、同じく Rolldown）は ESM 版 `dist/katex.mjs` を事前バンドルする際も壊す**ことを確認した（`.vite/deps/katex.js` 化された時点で破壊）。
- ESM で読み込む mermaid / shiki は破壊されない。

つまり **KaTeX 本体・バージョン・セキュリティ改修とは無関係**で、「Rolldown が katex を再バンドルする際に壊す」というバンドラー起因の不具合。CJS 経路（release build）と optimizeDeps 経路（dev）の両方で顕在化する。

## 決定事項

**KaTeX を「壊れない ESM ビルド（`dist/katex.mjs`）」で読み込ませ、Rolldown が壊す CJS/UMD 経路と dev の事前バンドルの両方を回避する。** 2点で対応する。

1. **release / バンドル本体（`app/src/lib/markdown/engine.ts`）**: プラグイン内の `require('katex')`（UMD、壊れる）に依存せず、ESM の `import("katex")`（`import` 条件で `dist/katex.mjs` に解決）で取得した KaTeX を、プラグインの `options.katex` に**明示注入**して使わせる。

   ```ts
   katexPluginPromise = Promise.all([
     import("@traptitech/markdown-it-katex"),
     import("katex"),
   ]).then(([pluginMod, katexMod]) => {
     const plugin = pluginMod.default as PluginWithParams;
     const katex = katexMod.default;
     // options.katex を渡すとプラグインは自前の require('katex') ではなくこれを使う
     const wrapped: PluginWithParams = (md, ...params) => {
       const options = (params[0] as Record<string, unknown> | undefined) ?? {};
       plugin(md, { ...options, katex });
     };
     return wrapped;
   });
   ```

2. **dev（`app/vite.config.js`）**: dev の `optimizeDeps` が `dist/katex.mjs` を事前バンドルする際にも壊すため、katex を事前バンドルから除外し素の ESM を読ませる。

   ```js
   optimizeDeps: { exclude: ["katex"] },
   ```

### 検討したが採らなかった案: `resolve.alias`

`resolve.alias` で `^katex$` を `dist/katex.mjs` へ解決させる案も試した。release build では有効だったが、**dev の `optimizeDeps` に対して不安定**で（クリーン起動でも破壊された CJS 版にフォールバックすることがあった）、再現性に欠けたため採用しなかった。プラグイン API（`options.katex`）への明示注入の方が決定的で堅い。

### 検証結果（dev・release 双方をクリーン環境で確認）

| 環境 | 結果 |
|---|---|
| dev（`tauri dev`・全プロセス掃除＋`.vite`削除の完全クリーン起動） | `\frac` を含む数式が `<mfrac>` で正常描画・エラー0 |
| release build（`.exe` 実起動・セッション復元経由） | `hasMfrac: true` / `katexError: 0` |

> dev 検証の注意: `npm run tauri dev` の vite サーバーが孤児化して残ると、古い（壊れた）バンドルを配信し続けるため誤った結果になる。検証時は feathermd/vite プロセスを掃除し `.vite` を削除してから起動すること。

## 影響・トレードオフ

- **メリット**: dev/release とも数式描画が復旧。プラグインの内部解決に依存せず ESM 版を明示注入するため決定的。
- **注意点（この不具合クラスの性質）**:
  - **Node ベースのユニットテスト（vitest 含む）を素通りし、実バンドル後のアプリでのみ顕在化する**。回帰検知はユニットテストでは難しく、**実アプリでの目視／E2E 確認が最有効**。
  - 今後 **Vite / Rolldown を更新する際は、数式描画のスモーク確認を行う**こと。
- `import("katex")` は top-level の `katex`（現状 0.17.0）の ESM 版に解決される（0.17.0 の描画自体は正常）。プラグイン同梱の nested `katex@0.16.47` は使われなくなる。

### 他レンダラーへの一般化（将来の設計指針）

本件は「Rolldown が特定の依存を再バンドル時に壊す」性質のため、レンダラー実装形態で影響が分かれる。

- **js-native 型（JSライブラリ同梱: mermaid・katex 等）**: **CommonJS/UMD を `require` 経由で同梱するライブラリは Rolldown で壊れるリスク**があり、ESM ネイティブを優先する。壊れた場合も本ADRのように「ESM ビルドを明示的に import して使う／optimizeDeps から除外する」で回避できることが多い。追加時は実アプリでの目視確認を必須にする。
- **external-process / cloud-api 型（PlantUML・Kroki 等の画像出力）**: 複雑なパーサを同梱しないため本件の影響はほぼ受けない。代わりに **CSP（`connect-src`／`img-src` の穴あけ）** と **返り値 SVG のサニタイズ**（[[ADR-009]] のMermaid同様、`{@html}`/`innerHTML` 挿入時の XSS 対策）が共通の設計ポイントになる。
