# 技術設計: 最近開いたファイル・フォルダー (recent-files)

## ステータス

完了

---

## 1. 概要

`settingsStore`/`settings-store.ts`と同じ「Svelte 5 runesストア + tauri-plugin-storeによる永続化」パターンを踏襲するが、関心事が異なる（UI設定 vs 履歴）ため、**別モジュール・別ファイル**として実装する。

記録のフックは1箇所に集約する: ファイルは既存の`openMarkdownFile(path)`（`file-actions.ts`）、フォルダーは新規に切り出す`openFolder(path)`。呼び出し経路（ダイアログ・サイドバーのファイルツリークリック・本文中のリンク遷移・最近開いた一覧のクリック自体）を問わず、これらの関数を通れば必ず記録される。

```
openMarkdownFile(path) / openFolder(path)
  → 実処理（ファイル読込 or ディレクトリ読込・ルート設定）
  → recentStore.addFile(path) / addFolder(path)
    → 重複排除して先頭に追加、最大10件にトリム
  → void saveRecent()（fire-and-forget、既存のsaveSettings呼び出しパターンに合わせる）
```

---

## 2. 未決定事項の確定

- **永続化方式**: 別ファイル`recent.json`とする。`settings.json`（UI設定）とは関心事が異なり、設定リセット等の操作と混ざらないようにするため分離する
- **存在しないパスをクリックした場合**: 追加のエラーハンドリングは行わない。`openMarkdownFile`は失敗時に例外を投げる（呼び出し元の`handleClick`等が既存のエラー表示で処理）、`openFolder`は`openFolderDialog`と同じ`try/catch`で`alert()`表示する。一覧からの自動削除は行わない（スコープ外）

---

## 3. `src/lib/stores/recent.svelte.ts`（新規）

```typescript
export interface RecentEntry {
  path: string;
  title: string;
}

const MAX_RECENT = 10;

function toEntry(path: string): RecentEntry {
  const title = path.replace(/\\/g, "/").split("/").pop() ?? path;
  return { path, title };
}

function pushRecent(list: RecentEntry[], path: string): RecentEntry[] {
  const filtered = list.filter((e) => e.path !== path);
  return [toEntry(path), ...filtered].slice(0, MAX_RECENT);
}

function createRecentStore() {
  let files = $state<RecentEntry[]>([]);
  let folders = $state<RecentEntry[]>([]);

  return {
    get files() {
      return files;
    },
    get folders() {
      return folders;
    },
    addFile(path: string) {
      files = pushRecent(files, path);
    },
    addFolder(path: string) {
      folders = pushRecent(folders, path);
    },
    setAll(data: { files: RecentEntry[]; folders: RecentEntry[] }) {
      files = data.files;
      folders = data.folders;
    },
  };
}

export const recentStore = createRecentStore();
```

---

## 4. `src/lib/recent-store.ts`（新規、永続化）

`settings-store.ts`と同構造。

```typescript
import { load } from "@tauri-apps/plugin-store";
import { recentStore, type RecentEntry } from "$lib/stores/recent.svelte";

const STORE_FILE = "recent.json";
let store: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!store) {
    store = await load(STORE_FILE, { autoSave: false, defaults: {} });
  }
  return store;
}

export async function loadRecent(): Promise<void> {
  try {
    const s = await getStore();
    const files = (await s.get<RecentEntry[]>("files")) ?? [];
    const folders = (await s.get<RecentEntry[]>("folders")) ?? [];
    recentStore.setAll({ files, folders });
  } catch (e) {
    console.warn("最近開いた一覧の読み込みに失敗しました:", e);
  }
}

export async function saveRecent(): Promise<void> {
  try {
    const s = await getStore();
    await s.set("files", recentStore.files);
    await s.set("folders", recentStore.folders);
    await s.save();
  } catch (e) {
    console.warn("最近開いた一覧の保存に失敗しました:", e);
  }
}
```

---

## 5. `src/lib/actions/file-actions.ts` の変更

```diff
+import { recentStore } from "$lib/stores/recent.svelte";
+import { saveRecent } from "$lib/recent-store";
...
 export async function openMarkdownFile(path: string): Promise<void> {
   ...
   if (isNew) {
     await invoke("watch_path", { path });
   }
+
+  recentStore.addFile(path);
+  void saveRecent();
 }
```

---

## 6. `src/lib/actions/dialog-actions.ts` の変更

フォルダーを開く実処理を`openFolder(path)`として切り出し、ダイアログからも最近開いた一覧のクリックからも共通で呼べるようにする。

```diff
+import { recentStore } from "$lib/stores/recent.svelte";
+import { saveRecent } from "$lib/recent-store";
+
+/** 指定パスをエクスプローラーのルートとして開く */
+export async function openFolder(path: string): Promise<void> {
+  const tree = await invoke<FileEntry[]>("read_directory", { path });
+  explorerStore.setRoot(path, tree);
+  if (!settingsStore.settings.sidebarVisible) {
+    settingsStore.toggleSidebar();
+  }
+  recentStore.addFolder(path);
+  void saveRecent();
+}

 export async function openFolderDialog(): Promise<void> {
   const selected = await open({ directory: true });
   if (!selected) return;
   const path = (typeof selected === "string" ? selected : selected[0]).replace(/\\/g, "/");
   try {
-    const tree = await invoke<FileEntry[]>("read_directory", { path });
-    explorerStore.setRoot(path, tree);
-    if (!settingsStore.settings.sidebarVisible) {
-      settingsStore.toggleSidebar();
-    }
+    await openFolder(path);
   } catch (err) {
     alert(`フォルダを開けませんでした:\n${path}\n${err}`);
   }
 }
```

---

## 7. UI: 空状態への一覧表示

### 7.1 `Sidebar.svelte`（フォルダー空状態）

```diff
+import { recentStore } from "$lib/stores/recent.svelte";
+import { openFolder } from "$lib/actions/dialog-actions";
...
     {#if explorerStore.tree.length === 0}
-      <p class="px-3 py-2 text-xs text-muted-foreground">フォルダを開いてください</p>
+      {#if recentStore.folders.length > 0}
+        <p class="px-3 pt-2 text-xs text-muted-foreground">最近開いたフォルダー</p>
+        <ul>
+          {#each recentStore.folders as folder (folder.path)}
+            <li>
+              <button
+                class="w-full truncate px-3 py-1 text-left text-xs hover:bg-accent"
+                title={folder.path}
+                onclick={() => openFolder(folder.path)}
+              >
+                {folder.title}
+              </button>
+            </li>
+          {/each}
+        </ul>
+      {:else}
+        <p class="px-3 py-2 text-xs text-muted-foreground">フォルダを開いてください</p>
+      {/if}
     {:else}
       <FileTree entries={explorerStore.tree} depth={0} />
     {/if}
```

`openFolder`呼び出しの失敗（存在しないパス等）は`try/catch`し`alert()`表示する。

### 7.2 `MarkdownViewer.svelte`（ファイル空状態）

```diff
+import { recentStore } from "$lib/stores/recent.svelte";
+import { openMarkdownFile } from "$lib/actions/file-actions"; // 既存import済み
...
     {:else}
       <div class="flex h-full items-center justify-center text-muted-foreground">
-        <p class="text-sm">ファイルを開いてください</p>
+        {#if recentStore.files.length > 0}
+          <div class="text-sm">
+            <p class="mb-2 text-center">最近開いたファイル</p>
+            <ul>
+              {#each recentStore.files as file (file.path)}
+                <li>
+                  <button
+                    class="w-full truncate px-2 py-1 text-left hover:bg-accent"
+                    title={file.path}
+                    onclick={() => openMarkdownFile(file.path).catch((e) => alert(String(e)))}
+                  >
+                    {file.title}
+                  </button>
+                </li>
+              {/each}
+            </ul>
+          </div>
+        {:else}
+          <p class="text-sm">ファイルを開いてください</p>
+        {/if}
       </div>
     {/if}
```

---

## 8. `+page.svelte` の変更

起動時に`loadSettings()`と並行して`loadRecent()`を呼ぶ。

```diff
+import { loadRecent } from "$lib/recent-store";
...
   onMount(async () => {
     warmupHighlighter();
-    await loadSettings();
+    await Promise.all([loadSettings(), loadRecent()]);
     ...
   });
```

---

## 9. データフロー

```
ファイル/フォルダを開く（経路問わず）
  → openMarkdownFile(path) / openFolder(path)
    → recentStore.addFile/addFolder(path) → saveRecent()（fire-and-forget）

アプリ起動
  → loadRecent() → recentStore.setAll(...)

空状態画面
  → recentStore.files / recentStore.folders を参照して一覧描画
    → クリック → openMarkdownFile(path) / openFolder(path)（再度recentStoreへ記録され先頭に移動）
```

---

## 10. 残課題

なし。設計フェーズ完了。一覧からの個別削除・自動プルーニングはスコープ外（`.kiro/backlog.md`へ候補として残す）。
