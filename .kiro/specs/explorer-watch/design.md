# 技術設計: エクスプローラーのファイル増減ウォッチ (explorer-watch)

## ステータス

完了

---

## 1. 概要

展開中の各ディレクトリ（＋ルート）を `notify` の **NonRecursive監視**で個別にウォッチし、変化イベントが来たら**そのディレクトリ1階層を `read_directory` で読み直して差し替える**。1階層読みは安価なため、イベント種別（作成／削除／リネーム）を細かく解釈せず「変化があったら読み直す」に統一する。

```
表示状態変更 → reconcile_directory_watches(ルート＋表示中ディレクトリ)
  → dir直下で追加/削除/リネーム発生
  → notify → デバウンス(400ms) → "directory-changed"（payload=dir）
  → フロント: read_directory(dir) → setChildren(dir, merge)
折りたたみ・リロード → 同コマンドで不要監視を一括解除
```

---

## 2. 未決定事項の確定

- **イベント通知の粒度**: ディレクトリ単位とする。変化した個別パスをフロントで解釈する方式は、リネーム（旧パス＋新パスの2イベント）やエディタの多段階保存の組み合わせで壊れやすい。「監視ディレクトリで何かあった」だけ伝えて丸ごと読み直す方が単純で堅牢。gitignore・拡張子フィルター・ソートも `read_directory` 側で自動的に再適用される
- **監視数の上限**: ファイル監視はセッション永続化上限と同じ100件、Explorer監視はルート1件＋セッション復元可能な展開64件の計65件。各単体登録コマンドと一括同期コマンドの双方でRust側が検証する

---

## 3. バックエンド (Rust)

### 3.1 監視コマンド（`commands/watcher.rs`）

- `watch_directory(path)`: `notify::recommended_watcher` + `RecursiveMode::NonRecursive` で監視。イベント種別は既存の `classify_event_kind` 相当で Create / Modify / Remove を対象とし、**種別を問わずデバウンス後に `"directory-changed"` イベント（payload = 監視対象ディレクトリのパス）を1回送出**する
- デバウンスは既存の `DEBOUNCE_WINDOW`（400ms）方式を流用する（`npm install` のような大量変化も1回の読み直しにまとまる）
- `unwatch_directory(path)`: 監視解除
- `reconcile_directory_watches(paths)`: 要求された集合をすべてcanonicalize・AllowedRoots検証してから、不足分を構築し、不要分を解除してRust側台帳を一括で収束させる。追加分の構築に失敗した場合は既存集合を変更しない

### 3.2 状態管理

- ファイル監視（`watch_path`、タブで開いたファイル用）と用途・ライフサイクルが異なるため、`DirWatcherState` を別途 `.manage()` してキー衝突を避ける
- 監視パスは信頼済みルート（`AllowedRoots`）配下であることを `watch_directory` 側でも検証する
- WebView側に監視済み台帳を持たせない。Rust側台帳を唯一の正とし、パスキーはWindowsでは大文字小文字を同一視する

---

## 4. フロントエンド

### 4.1 監視ライフサイクル（`actions/explorer-actions.ts`）

- `toggleDirectory` / `openFolder` / `reloadFolderTree`: 現在表示中の集合を `reconcile_directory_watches` へ送る
- 複数の同期要求はフロント側で直列化し、未開始の古い世代をスキップする。実行中に状態が変わった場合も最後の集合が必ず最後に適用される
- `respectGitignore` トグル変更時は `reloadFolderTree` 経由で張り直される（既存挙動に乗る）

### 4.2 イベント処理

- `listen("directory-changed", (dir) => refreshDirectory(dir))` を `+page.svelte` の既存リスナー群と同じ場所に登録
- `refreshDirectory(dir)`: `loadDirectory(dir)` で1階層を再取得し、ツリーの該当レベルを差し替える

### 4.3 差し替え時のマージ（展開状態の維持）

`explorerStore` に `mergeChildren(path, newEntries)` を追加する:

- 新エントリのうち、**同一パスの既存エントリが `children` を持つ場合はそれを引き継ぐ**（展開中の孫ツリーを失わない）
- 消えたパスは `expandedDirs` / `loadingDirs` からも除去し、次の一括同期でそのパスと配下の監視を解除する
- ルート直下の変化は `tree` 自体を同じ規則で差し替える

---

## 5. 既存機能との関係

- **タブのファイル監視（`watch_path`）とは独立**: 開いているファイルの変更・削除検知の挙動は変えない
- **explorer-lazy-load が前提**: 1階層再読込が安価であることに依存する。全再帰時代にはこの設計は成立しなかった
