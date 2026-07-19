# 技術設計: タブのピン留め (tab-pin)

## ステータス

完了

---

## 1. 概要

`Tab`型に`pinned`フラグを追加し、`tabStore`のクローズ系メソッド（`close`/`closeAndUnwatch`）でピン留めタブを弾くガードを入れる。UIは`TabBar.svelte`にピン留めトグルボタンを追加し、ピン留め中はクローズボタンを非表示にする。

```
TabBar: ピンボタンクリック
  → tabStore.togglePin(id)
    → tab.pinned反転
      → ピン留め中: クローズボタン非表示、ピンアイコンが状態を表す見た目に変化
      → ピン留め解除: クローズボタン再表示

クローズボタンクリック / Ctrl+W (tab.close command)
  → tabStore.closeAndUnwatch(id) / close(id)
    → tab.pinnedがtrueなら何もせず終了（ガード）
```

---

## 2. 未決定事項の確定

- **アイコンの配置**: ピンボタンをクローズボタンの左隣に常時表示する（ホバー時のみ表示、のような仕掛けは追加しない。既存のクローズボタンも常時表示のため一貫させる）
- **クローズボタンの扱い**: ピン留め中は非表示にする（クリックしても閉じられないボタンを表示し続けるのはUXとして不親切なため）
- **アイコンの見た目**: `@lucide/svelte`の`Pin`/`PinOff`を使う
  - 未ピン留め: `Pin`アイコン、`text-muted-foreground`（控えめ）、クリックでピン留め
  - ピン留め中: `PinOff`アイコン、`text-foreground`（強調）、クリックでピン留め解除

---

## 3. `src/lib/types/index.ts` の変更

```diff
 export interface Tab {
   id: string;
   path: string;
   title: string;
   status?: "ok" | "deleted";
+  pinned?: boolean;
 }
```

---

## 4. `src/lib/stores/tab.svelte.ts` の変更

```diff
+    togglePin(id: string) {
+      tabs = tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
+    },
     close(id: string) {
+      const target = tabs.find((t) => t.id === id);
+      if (target?.pinned) return;
       const idx = tabs.findIndex((t) => t.id === id);
       tabs = tabs.filter((t) => t.id !== id);
       if (activeTabId === id) {
         activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
       }
     },
     ...
     async closeAndUnwatch(id: string) {
       const tab = tabs.find((t) => t.id === id);
       if (!tab) return;
+      if (tab.pinned) return;
       await invoke("unwatch_path", { path: tab.path }).catch(() => {});
       this.close(id);
       contentStore.delete(tab.path);
     },
```

- `close()`と`closeAndUnwatch()`の両方にガードを入れる（`close()`は`cycle`/`jumpTo`等とは独立した唯一のクローズ経路なので、ここを塞げば`Ctrl+W`・クローズボタンいずれも防げる）
- `closeAndUnwatch()`内で`this.close(id)`を呼ぶため二重チェックになるが、後続の`unwatch_path`呼び出し・`contentStore.delete`を確実にスキップするため`closeAndUnwatch()`側にも明示的にガードを置く

---

## 5. `src/lib/components/TabBar.svelte` の変更

```diff
+import { Pin, PinOff } from "@lucide/svelte";
...
       <button
         class="px-2 text-muted-foreground hover:text-foreground"
+        onclick={() => tabStore.togglePin(tab.id)}
+        aria-label={tab.pinned ? "ピン留めを解除" : "タブをピン留め"}
+        title={tab.pinned ? "ピン留めを解除" : "タブをピン留め"}
+      >
+        {#if tab.pinned}
+          <PinOff size={12} class="text-foreground" />
+        {:else}
+          <Pin size={12} />
+        {/if}
+      </button>
+      {#if !tab.pinned}
+        <button
+          class="px-2 text-muted-foreground hover:text-foreground"
+          onclick={() => tabStore.closeAndUnwatch(tab.id)}
+          aria-label="タブを閉じる"
+        >
+          ✕
+        </button>
+      {/if}
```

---

## 6. データフロー

```
TabBar: ピンボタンクリック → tabStore.togglePin(id) → pinned反転（$stateなので自動再描画）
  → ピン留め中: クローズボタンが{#if !tab.pinned}で非表示になる

クローズボタン / Ctrl+W (tab.close command → closeAndUnwatch)
  → tab.pinned===true → 何もせず return（ファイル監視解除・タブ配列変更・contentStore削除いずれも実行されない）
```

---

## 7. 残課題

なし。設計フェーズ完了。ピン留めタブの並び替え・先頭固定・状態永続化はスコープ外（`.kiro/backlog.md`参照）。
