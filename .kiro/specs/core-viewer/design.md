# 技術設計: コアビューワー (core-viewer)

## ステータス

完了（Kroki等の外部プロセス・クラウドAPI型レンダラーの実装方式はv2で決定）

---

## 1. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  WebView（フロントエンド）                                │
│                                                          │
│  ┌──────────┐  ┌─────────────┐  ┌───────────────────┐  │
│  │ File     │  │  Tab Bar    │  │   TOC Panel       │  │
│  │ Explorer │  ├─────────────┤  └───────────────────┘  │
│  │(Sidebar) │  │  Markdown   │                          │
│  │          │  │  Viewer     │                          │
│  └──────────┘  │  (Content)  │                          │
│                └─────────────┘                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Markdown Pipeline                                │   │
│  │  Parser → Token → Renderer Plugin System         │   │
│  │              ↓              ↓              ↓     │   │
│  │         JS-native      External        Cloud    │   │
│  │        (Mermaid,TeX)   Process         API      │   │
│  └──────────────────┬───────────────────────────────┘   │
└─────────────────────┼───────────────────────────────────┘
                      │ Tauri IPC (Commands / Events)
┌─────────────────────┼───────────────────────────────────┐
│  Rust バックエンド   │                                   │
│                      ↓                                   │
│  ┌───────────────┐  ┌─────────────────┐                 │
│  │ File System   │  │ Process Manager │                  │
│  │ - open/read   │  │ - Kroki local   │                  │
│  │ - dir walk    │  │ - 将来のプラグイン│                 │
│  │ - file watch  │  └─────────────────┘                  │
│  │  (notify)     │                                       │
│  └───────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 2. フロントエンドフレームワーク選定

### 候補比較

| 観点 | React | Vue 3 | **Svelte** |
|---|---|---|---|
| バンドルサイズ | 大（ランタイム含む） | 中 | **小（コンパイル時最適化）** |
| リアクティビティ | 仮想DOM | 仮想DOM | **コンパイル時・DOM直接更新** |
| Tauriとの相性 | 良い（公式テンプレートあり） | 良い（公式テンプレートあり） | **最良（公式テンプレートあり）** |
| ファイル更新イベント受信 | useEffect で対応 | watch で対応 | **$: / store で自然に書ける** |
| 状態管理 | Zustand / Jotai 等 | Pinia | **標準store（writable/derived）** |
| エコシステム | 最大 | 大 | 中（成長中） |
| 学習コスト | 中 | 低〜中 | 低 |

### 【決定】Svelte（SvelteKit なし、SPA構成）を採用

**理由**
- Tauriアプリはファイルをローカルで提供するため、SSR/ルーティングは不要。SvelteKitは使わず、Vite + SvelteのみのシンプルなSPA構成とする
- ランタイムを持たないコンパイル方式はWebView内での動作に最適（軽量・高速）
- Tauriのイベントシステム（`file-changed` 等）がSvelteのstoreと自然に連携できる
- ファイル監視による自動再描画（US-004）がリアクティブなstoreで簡潔に実装できる

**ADR**: ADR-003として記録する

---

## 3. Markdownパーサー選定

### 候補比較

| 観点 | marked | **markdown-it** | remark (unified) |
|---|---|---|---|
| パース方式 | トークン→HTML | トークン→HTML | AST（mdast） |
| CommonMark準拠 | △ | **○** | ○ |
| GFM（テーブル等） | ○ | **○（プラグイン）** | ○（remark-gfm） |
| プラグインAPI | シンプルだが限定的 | **豊富・安定** | 最強だが複雑 |
| 既存レンダラー連携 | markdown-it-mermaid等なし | **markdown-it-mermaid / katex等あり** | remark-mermaid等あり |
| 速度 | 最速 | **高速** | やや遅い |
| 拡張性 | 低 | **高** | 最高 |

### 【決定】markdown-it を採用

**理由**
- CommonMark準拠でGFMプラグインも整備されている
- JS内蔵型レンダラー（Mermaid、KaTeX）との連携プラグインが既に存在する
- プラグインAPIがシンプルで、カスタムレンダラーの差し込みが容易
- remarkほど複雑でなく、v1の実装コストが低い

**設計上の制約**: レンダラープラグインのインターフェースをパーサー非依存に設計し、将来remarkへの移行を可能にする

**ADR**: ADR-004として記録する

---

## 4. レンダラープラグインシステム設計

### 4.1 レンダラー種別

```typescript
type RendererType = 'js-native' | 'external-process' | 'cloud-api';

interface Renderer {
  name: string;
  type: RendererType;
  // このレンダラーが処理するコードブロックの言語名（例: ['mermaid', 'kroki']）
  languages: string[];
  enabled: boolean;
  render(code: string, language: string): Promise<RendererResult>;
}

interface RendererResult {
  html: string;      // レンダリング結果のHTML/SVG
  error?: string;    // エラー時はここにメッセージ
}
```

### 4.2 種別ごとの実装方針

#### JS内蔵型（v1実装対象）

WebView内で完結。Tauriバックエンドとの通信不要。

```
code block
  → markdown-it プラグインがフック
  → Renderer.render() を呼び出し
  → HTML/SVGを返す → DOMに差し込む
```

- **Mermaid**: `mermaid.js` を直接呼び出し
- **TeX（数式）**: `KaTeX` を使用（MathJaxより高速、SSR不要のためKaTeX優先）

#### 外部プロセス型（v2以降）

Rustバックエンドがプロセスを起動・管理。結果をIPCで返す。

```
code block
  → Tauri IPC コマンド呼び出し（render_external）
  → Rust が外部プロセス（Krokiコンテナ等）に送信
  → 結果SVGをフロントエンドに返す
```

#### クラウドAPI型（v2以降）

```
code block
  → Tauri IPC コマンド呼び出し（render_cloud）
  → Rust が外部APIをHTTPリクエスト
  → 結果をフロントエンドに返す
```

※ v1ではインターフェース定義のみ行い、外部プロセス・クラウドAPI型の実装はスタブとする

### 4.3 v1バンドル対象レンダラー

| レンダラー | 種別 | ライブラリ |
|---|---|---|
| Mermaid | JS内蔵型 | mermaid.js |
| 数式（TeX） | JS内蔵型 | KaTeX |
| コードハイライト | JS内蔵型 | **shiki**（ADR-006） |

---

## 5. Tauri IPC設計

### 5.1 Rustコマンド（フロント→Rust）

```rust
// ファイル操作
open_file(path: String) -> Result<FileContent, Error>
read_directory(path: String) -> Result<Vec<FileEntry>, Error>

// ファイル監視
watch_path(path: String) -> Result<(), Error>
unwatch_path(path: String) -> Result<(), Error>

// 外部レンダラー（v2）
render_external(renderer: String, code: String) -> Result<String, Error>
render_cloud(endpoint: String, code: String) -> Result<String, Error>

// OS連携
open_in_browser(url: String) -> Result<(), Error>
```

### 5.2 Rustイベント（Rust→フロント）

```rust
// ファイル監視イベント
"file-changed"  { path: String }
"file-deleted"  { path: String }
"file-created"  { path: String }
```

---

## 6. コンポーネント構成

```
App
├── Toolbar                   // ファイル・ディレクトリ開くボタン
├── MainLayout
│   ├── Sidebar               // ファイルエクスプローラー
│   │   └── FileTree          // ツリー表示（再帰コンポーネント）
│   ├── ContentArea
│   │   ├── TabBar            // タブ管理
│   │   └── MarkdownViewer    // メインビューワー
│   │       ├── RenderedContent   // markdown-it出力のDOM
│   │       └── ScrollSync        // TOCとのスクロール同期
│   └── TOCPanel              // 目次パネル（トグル可）
└── StatusBar                 // 現在ファイルパス等
```

---

## 7. 状態管理設計

Svelteの標準storeを使用。

```typescript
// 開いているファイルのタブ状態
tabStore: {
  tabs: Tab[];           // { id, path, title }[]
  activeTabId: string;
}

// ファイルエクスプローラー状態
explorerStore: {
  rootPath: string | null;
  tree: FileEntry[];
  expandedDirs: Set<string>;
}

// 各ファイルのコンテンツキャッシュ
contentStore: Map<path, { raw: string; rendered: string }>

// 設定（レンダラーON/OFF等）
settingsStore: {
  renderers: Record<string, { enabled: boolean }>;
  tocVisible: boolean;
}
```

---

## 8. ファイル監視設計

Rustの `notify` クレートでファイル変更を監視し、Tauriイベントとしてフロントへ通知。

```
ユーザーがファイルを開く
  → watch_path(path) コマンド発行
  → Rustが notify でパスを監視登録
  → ファイル変更検知
  → "file-changed" イベントをフロントへ送信
  → contentStore を更新 → MarkdownViewer が再描画
  → スクロール位置を復元
```

---

## 9. リンクナビゲーション設計

MarkdownViewer内のアンカークリックをインターセプトし、リンク種別を判定する。

```typescript
function handleLinkClick(href: string) {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    invoke('open_in_browser', { url: href });
  } else if (href.startsWith('#')) {
    scrollToAnchor(href);
  } else {
    // ローカルファイルリンク（相対・絶対パス）
    openFile(resolveRelativePath(currentFilePath, href));
  }
}
```

---

## 10. UIスタイリング・外観

- **スタイリング**: Tailwind CSS（ADR-006）
- **ウィンドウ**: OSネイティブタイトルバー（ADR-006）
- **UIコンポーネント**: shadcn-svelte（ADR-007）

---

## 11. UX仕様

### ファイルエクスプローラー

- 隠しファイル（`.`始まりのファイル・ディレクトリ）は**デフォルト非表示**
- 設定でトグルON可能

### タブ

- 最大数制限なし
- タブが増えた場合は**横スクロール**で対応
- 同一ファイルを重複して開かない（既存タブをアクティブにする）

---

## 12. 確定済み技術スタック一覧

| レイヤー | 技術 | ADR |
|---|---|---|
| デスクトップフレームワーク | Tauri v2 (Rust) | ADR-002 |
| フロントエンド | Svelte + Vite (SPA) | ADR-003 |
| UIコンポーネント | shadcn-svelte | ADR-007 |
| スタイリング | Tailwind CSS | ADR-006 |
| Markdownパーサー | markdown-it | ADR-004 |
| 数式レンダラー | KaTeX | ADR-005 |
| 図レンダラー（v1） | Mermaid.js | — |
| コードハイライト | shiki | ADR-006 |
| ファイル監視（Rust） | notify クレート | — |
| ウィンドウ外観 | OSネイティブ | ADR-006 |

残課題なし。設計フェーズ完了。
