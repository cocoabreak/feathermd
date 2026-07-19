# 技術設計: タブ状態の永続化・復元 (session-restore)

## ステータス

完了

> **設計更新 (2026-07-19 / session-restore-enhancement)**
> 正式リリース前のため、本文の初期 `activePath` / `rootPath` 形式は現行実装との互換対象ではない。現行スキーマは `activeIndex` / `explorer` を使用し、詳細は `../session-restore-enhancement/design.md` を正とする。

---

## 1. 概要

`recentStore`/`recent-store.ts`と同じ「Svelte 5 runesストア + tauri-plugin-storeによる永続化」パターンを踏襲するが、関心事が異なる（履歴 vs 現在開いているセッション状態）ため、別ファイル・別モジュールとして実装する。

`Ctrl+R`/`F5`によるリロード（Rustプロセスは継続する）と、アプリ本来の再起動（プロセスの初回起動）は区別する。前者は従来通り自動復元、後者はEdge等のブラウザを参考に「復元しますか？」の確認をトースト形式で挟む。両者の判定は、Rust側で管理する`LaunchState`（プロセス内で最初の呼び出しのみ`true`を返す）を使う。

```
起動時: loadTabsOnStartup()
  → is_fresh_launch を呼ぶ
    → false（リロード。プロセス継続中の2回目以降の呼び出し）:
        restoreSavedTabs() を即座に呼ぶ（従来通り自動復元、確認なし）
    → true（アプリ本来の起動。プロセス内で最初の呼び出し）:
        自動復元はせず、保存済みタブ/ルートフォルダーの有無だけ返す
        → 呼び出し側（+page.svelte）が promptRestore=true ならトーストを表示
        → 「復元する」→ restoreSavedTabs() を呼ぶ
        → 「破棄する」→ discardSavedTabs() を呼ぶ（tabs.jsonを即座に空へ）

通常操作中: タブの追加/削除/切替/ピン留め変更、エクスプローラーのルートフォルダー変更
  → +page.svelteの$effectが検知 → saveTabs()（fire-and-forget）
  ただし、トースト表示中（判断待ち）は保存を止める（3節）
```

---

## 2. 未決定事項の確定

- **永続化ファイル**: 別ファイル`tabs.json`とする。`recent.json`と同じ理由（関心事が異なり、設定リセット等の操作と混ざらないようにするため）
- **保存トリガーの実装方式**: `+page.svelte`に`$effect`を1つ追加し、`tabStore.tabs`・`tabStore.activeTabId`・`explorerStore.rootPath`を読むことでリアクティブに検知して`saveTabs()`を呼ぶ。既存の`settingsStore`/`recentStore`は各操作箇所（コンポーネント・action関数）で明示的に`saveX()`を呼ぶ方式だが、タブは`TabBar.svelte`・`builtin.ts`・`file-actions.ts`など変更箇所が多く、呼び忘れによる保存漏れのリスクが高い。単一のリアクティブeffectに集約することで、将来tabStoreの変更経路が増えても保存漏れが起きない設計にする（DRY優先の意図的な逸脱）
- **復元失敗時の扱い**: `read_file`/`read_directory`に失敗したタブ・フォルダーは復元自体をスキップする（エラー状態としては残さない）。存在確認と内容取得を兼ねるため、失敗＝復元不要と判断する
- **リロードとアプリ再起動の区別**: Rust側に`LaunchState(AtomicBool)`を`tauri::State`として`manage`し、`is_fresh_launch`コマンドでプロセス内最初の呼び出しかどうかを判定する（4節）
- **アプリ再起動時の確認方法**: 画面下部の常時表示トースト（モーダルダイアログにはしない）。「復元する」「破棄する」の2択のみで、暗黙のdismiss（背景クリックやEscでの閉じる）は用意しない。「破棄する」を選ぶと保存済みセッション情報は即座に破棄する

---

## 3. 起動直後の空保存を防ぐガード

`$effect`は初回マウント時にも1度実行される。`onMount`内の`loadTabsOnStartup()`（非同期）が完了する前にこの初回実行が走ると、まだ何も復元していない空のタブ一覧で`tabs.json`を上書きしてしまう危険がある。`+page.svelte`に`hydrated`フラグを設け、復元完了まで保存を抑止する。

さらに、アプリ本来の起動でトーストを表示している間（ユーザーがまだ「復元する」/「破棄する」を選んでいない間）も、`tabStore`は空のままなので同様に保存を抑止する必要がある。この間にユーザーが新規でファイルを開く等の操作をしても、保存済みセッション情報を上書きしてはならない。`sessionRestorePromptStore.visible`もガード条件に含める。

```typescript
let hydrated = $state(false);

onMount(async () => {
  warmupHighlighter();
  const [, , sessionResult] = await Promise.all([
    loadSettings(),
    loadRecent(),
    loadTabsOnStartup(),
  ]);
  if (sessionResult.promptRestore) sessionRestorePromptStore.show();
  hydrated = true;
  // ...
});

$effect(() => {
  if (!hydrated || sessionRestorePromptStore.visible) return;
  // tabStore.tabs / activeTabId / explorerStore.rootPathを読むことで依存関係を登録する
  void tabStore.tabs;
  void tabStore.activeTabId;
  void explorerStore.rootPath;
  void saveTabs();
});
```

---

## 4. Rust側: `is_fresh_launch`コマンド（`src-tauri/src/commands/launch.rs`、新規）

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;

pub struct LaunchState(AtomicBool);

impl LaunchState {
    pub fn new() -> Self {
        Self(AtomicBool::new(false))
    }

    fn take_fresh(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }
}

#[tauri::command]
pub fn is_fresh_launch(state: State<'_, LaunchState>) -> bool {
    state.take_fresh()
}
```

`lib.rs`で`.manage(LaunchState::new())`し、`invoke_handler`に登録する。`AtomicBool`はプロセスの生存期間だけ保持されるため、`Ctrl+R`/`F5`でWebViewがリロードされてもリセットされない（Rustプロセス自体は継続するため）。一方、アプリを完全終了して再起動すると新しいプロセスになり`AtomicBool`も`false`から始まるため、最初の呼び出しは必ず`true`になる。

---

## 5. `src/lib/tabs-store.ts`（永続化）

`recent-store.ts`と同構造。`loadTabs`を`restoreSavedTabs`（実際の復元処理）と`loadTabsOnStartup`（起動時の判定・トースト要否の返却）に分割し、`discardSavedTabs`を追加した。ルートフォルダーの復元は`dialog-actions.ts`の`openFolder`をそのまま再利用する（サイドバー表示・最近使ったフォルダーへの追加も含めて既存の「フォルダーを開く」操作と同じ挙動にするため）。

```typescript
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { tabStore } from "$lib/stores/tab.svelte";
import { contentStore } from "$lib/stores/content.svelte";
import { explorerStore } from "$lib/stores/explorer.svelte";
import { openFolder } from "$lib/actions/dialog-actions";

const STORE_FILE = "tabs.json";

interface PersistedTab {
  path: string;
  pinned: boolean;
}

let store: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!store) {
    store = await load(STORE_FILE, { autoSave: false, defaults: {} });
  }
  return store;
}

function titleFromPath(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

/** 保存済みのタブ一覧・アクティブタブ・エクスプローラーのルートフォルダを実際に開き直す */
export async function restoreSavedTabs(): Promise<void> {
  try {
    const s = await getStore();
    const saved = (await s.get<PersistedTab[]>("tabs")) ?? [];
    const activePath = await s.get<string | null>("activePath");
    const rootPath = await s.get<string | null>("rootPath");

    for (const { path, pinned } of saved) {
      let raw: string;
      try {
        raw = await invoke<string>("read_file", { path });
      } catch {
        continue; // ファイルが読めない場合は黙ってスキップ（US-002）
      }
      contentStore.set(path, { raw });
      tabStore.addOrActivate({ id: crypto.randomUUID(), path, title: titleFromPath(path), pinned });
      await invoke("watch_path", { path }).catch(() => {});
    }

    if (activePath) {
      const tab = tabStore.tabs.find((t) => t.path === activePath);
      if (tab) tabStore.setActive(tab.id);
    }

    if (rootPath) {
      await openFolder(rootPath).catch(() => {}); // フォルダが見つからない場合は黙ってスキップ
    }
  } catch (e) {
    console.warn("タブの復元に失敗しました:", e);
  }
}

/** 保存済みタブを使わない場合に呼ぶ。tabs.jsonの内容を即座に破棄する */
export async function discardSavedTabs(): Promise<void> {
  try {
    const s = await getStore();
    await s.set("tabs", []);
    await s.set("activePath", null);
    await s.set("rootPath", null);
    await s.save();
  } catch (e) {
    console.warn("保存済みタブの破棄に失敗しました:", e);
  }
}

/**
 * 起動時に呼ぶ。Ctrl+R/F5によるリロード（Rustプロセスは継続）の場合は
 * 従来通り即座に復元する。アプリの実際の起動（プロセスの初回起動）の場合は
 * 自動復元せず、保存済みタブ/フォルダーがあるかどうかだけを返す
 * （呼び出し側でユーザーに復元するか確認する）。
 */
export async function loadTabsOnStartup(): Promise<{ promptRestore: boolean }> {
  let freshLaunch: boolean;
  try {
    freshLaunch = await invoke<boolean>("is_fresh_launch");
  } catch {
    freshLaunch = false; // 判定できない場合は従来通り即復元する
  }

  if (!freshLaunch) {
    await restoreSavedTabs();
    return { promptRestore: false };
  }

  try {
    const s = await getStore();
    const saved = (await s.get<PersistedTab[]>("tabs")) ?? [];
    const rootPath = await s.get<string | null>("rootPath");
    return { promptRestore: saved.length > 0 || !!rootPath };
  } catch {
    return { promptRestore: false };
  }
}

/** 現在開いているタブ一覧・アクティブタブ・エクスプローラーのルートフォルダをディスクに保存する */
export async function saveTabs(): Promise<void> {
  try {
    const s = await getStore();
    const activeTab = tabStore.tabs.find((t) => t.id === tabStore.activeTabId);
    await s.set(
      "tabs",
      tabStore.tabs.map((t) => ({ path: t.path, pinned: !!t.pinned }))
    );
    await s.set("activePath", activeTab?.path ?? null);
    await s.set("rootPath", explorerStore.rootPath);
    await s.save();
  } catch (e) {
    console.warn("タブの保存に失敗しました:", e);
  }
}
```

- `read_file`失敗時点でスキップするため、`contentStore`/`tabStore`のいずれにも中途半端な状態を残さない
- `watch_path`の失敗は`.catch(() => {})`で無視する（タブ自体は開いたままにする。監視できないだけで内容は読めているため、`closeAndUnwatch`の`unwatch_path`失敗時の扱いと同じ方針）
- `addOrActivate`はループ中に呼ぶたびその時点の`activeTabId`を新規タブへ切り替えるが、ループ終了後に保存済み`activePath`で`setActive`し直すため最終的な結果には影響しない
- `openFolder`の失敗（フォルダが既に存在しない等）も同様に黙ってスキップする

---

## 6. アプリ再起動時の復元確認トースト

`sessionRestorePromptStore`（`src/lib/stores/session-restore-prompt.svelte.ts`）で表示状態を保持し、`SessionRestoreToast.svelte`が画面下部に固定表示する。

- 「復元する」: `restoreSavedTabs()`を呼んだ後、トーストを閉じる
- 「破棄する」: `discardSavedTabs()`を呼んだ後、トーストを閉じる（`tabs.json`は空になり、次回起動時はトースト自体出なくなる）
- 背景クリックやEscによる暗黙のdismissは用意しない（2択のどちらかで必ず判断させる）

---

## 7. `+page.svelte` の変更

```diff
+import { loadTabsOnStartup, saveTabs } from "$lib/tabs-store";
+import { sessionRestorePromptStore } from "$lib/stores/session-restore-prompt.svelte";
+import SessionRestoreToast from "$lib/components/SessionRestoreToast.svelte";
...
   let hydrated = $state(false);

   onMount(async () => {
     warmupHighlighter();
-    await Promise.all([loadSettings(), loadRecent()]);
+    const [, , sessionResult] = await Promise.all([
+      loadSettings(),
+      loadRecent(),
+      loadTabsOnStartup(),
+    ]);
+    if (sessionResult.promptRestore) sessionRestorePromptStore.show();
     hydrated = true;
     ...
   });

   // タブの追加/削除/切替/ピン留め変更のたびに自動保存する
   $effect(() => {
-    if (!hydrated) return;
+    if (!hydrated || sessionRestorePromptStore.visible) return;
     void tabStore.tabs;
     void tabStore.activeTabId;
+    void explorerStore.rootPath;
     void saveTabs();
   });
+
+<SessionRestoreToast />
```

---

## 8. データフロー

```
アプリ起動（プロセスの初回起動）
  → loadTabsOnStartup() → is_fresh_launch が true
  → 自動復元はせず、保存済みタブ/ルートフォルダーの有無だけ確認
  → 1件以上あればトースト表示 → ユーザーが「復元する」/「破棄する」を選ぶまで待機（自動保存は停止）
  → 「復元する」: restoreSavedTabs() → 保存済みタブを順にread_file → 成功したものだけcontentStore/tabStoreへ反映・watch_path
                  → 保存済みactivePathのタブをsetActive → 保存済みrootPathがあればopenFolder()
  → 「破棄する」: discardSavedTabs() → tabs.jsonを空にする
  → hydrated = true

WebViewの右クリック「再読み込み」/ Ctrl+R/F5（同一プロセス内の2回目以降の呼び出し）
  → loadTabsOnStartup() → is_fresh_launch が false → restoreSavedTabs()を即座に呼ぶ（確認なし）
  → hydrated = true

タブの追加/削除/切替/ピン留め変更、エクスプローラーのルートフォルダー変更（経路問わず）
  → tabStore.tabs / activeTabId / explorerStore.rootPathが変化
  → $effectが検知（hydrated かつ トースト非表示のときのみ）→ saveTabs()（fire-and-forget）→ tabs.jsonへ保存
```

---

## 9. 残課題

なし。設計フェーズ完了。スクロール位置・TOC開閉状態・エクスプローラーの展開中サブフォルダの復元、WebView右クリックメニューの無効化はスコープ外。
