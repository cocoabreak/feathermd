# 技術設計: キーボードショートカット (keyboard-shortcuts)

## ステータス

完了

---

## 1. 概要

「コマンド（操作の実体）」と「キーバインド（キーcombo→コマンドidの対応表）」を分離する。
v1ではキーバインドはコード内の固定テーブルだが、将来ユーザー設定化する際にコマンド側の実装変更が不要になるようにする。

```
KeyboardEvent
  → comboFromEvent() でコンボ文字列化（例: "Ctrl+O"）
  → keymap[combo] でコマンドidを引く（例: "file.open"）
  → runCommand(id) でコマンド実行
```

---

## 2. コマンドレジストリ

`app/src/lib/commands/registry.ts` を新規作成。

```typescript
export interface Command {
  id: string;
  run: () => void | Promise<void>;
}

const commands = new Map<string, Command>();

export function registerCommand(command: Command): void {
  commands.set(command.id, command);
}

export function runCommand(id: string): void {
  void commands.get(id)?.run();
}
```

- シンプルな `Map` ベース。上書き登録は許容（開発中のホットリロード等を考慮し、エラーにしない）
- 将来のカスタマイズUIは、この `commands` の一覧（id一覧）を列挙するAPI（`listCommands()`）を追加することで対応可能。v1では未実装

---

## 3. キーマップとコンボ文字列化

`app/src/lib/commands/keymap.ts` を新規作成。

```typescript
export const keymap: Record<string, string> = {
  "Ctrl+O": "file.open",
  "Ctrl+Shift+O": "file.openFolder",
  "Ctrl+W": "tab.close",
  "Ctrl+Tab": "tab.next",
  "Ctrl+Shift+Tab": "tab.prev",
  "Ctrl+1": "tab.jumpTo:0",
  "Ctrl+2": "tab.jumpTo:1",
  "Ctrl+3": "tab.jumpTo:2",
  "Ctrl+4": "tab.jumpTo:3",
  "Ctrl+5": "tab.jumpTo:4",
  "Ctrl+6": "tab.jumpTo:5",
  "Ctrl+7": "tab.jumpTo:6",
  "Ctrl+8": "tab.jumpTo:7",
  "Ctrl+9": "tab.jumpTo:8",
  "Ctrl+B": "panel.toggleSidebar",
  "Ctrl+J": "panel.toggleToc",
  "Ctrl+,": "settings.open",
  Escape: "settings.close",
};

export function comboFromEvent(e: KeyboardEvent): string | null {
  // 修飾キー単体の押下は無視
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  if (e.key === "Escape") return "Escape";

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);

  return parts.join("+");
}
```

`tab.jumpTo:N` のようにコマンドidにパラメータを埋め込む方式を採る（レジストリを `id → Command` の単純なMapに保つため）。`Ctrl+1`〜`Ctrl+9` は起動時に `for` ループで9個登録する。

---

## 4. コマンド定義と登録

`app/src/lib/commands/builtin.ts` を新規作成し、既存のアクション/ストアを呼び出す形でコマンドを定義する。
アプリ起動時に一度だけ副作用として実行されるよう、`+page.svelte` の `onMount` の先頭で `import "$lib/commands/builtin"` する。

```typescript
import { registerCommand } from "./registry";
import { openFileDialog, openFolderDialog } from "$lib/actions/dialog-actions";
import { tabStore } from "$lib/stores/tab.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import { uiStore } from "$lib/stores/ui.svelte";

registerCommand({ id: "file.open", run: openFileDialog });
registerCommand({ id: "file.openFolder", run: openFolderDialog });

registerCommand({
  id: "tab.close",
  run: () => {
    const active = tabStore.tabs.find((t) => t.id === tabStore.activeTabId);
    if (active) tabStore.closeAndUnwatch(active.id);
  },
});
registerCommand({ id: "tab.next", run: () => tabStore.cycle(1) });
registerCommand({ id: "tab.prev", run: () => tabStore.cycle(-1) });
for (let i = 0; i < 9; i++) {
  registerCommand({ id: `tab.jumpTo:${i}`, run: () => tabStore.jumpTo(i) });
}

registerCommand({ id: "panel.toggleSidebar", run: () => settingsStore.toggleSidebar() });
registerCommand({ id: "panel.toggleToc", run: () => settingsStore.toggleToc() });

registerCommand({ id: "settings.open", run: () => uiStore.openSettings() });
registerCommand({ id: "settings.close", run: () => uiStore.closeSettings() });
```

### 4.1 既存コードのリファクタリング（ロジックの一本化）

- `Toolbar.svelte` の `handleOpenFile` / `handleOpenDirectory` の中身を `app/src/lib/actions/dialog-actions.ts`（新規）に `openFileDialog()` / `openFolderDialog()` として切り出す。`Toolbar.svelte` はこれを呼ぶだけにする。これによりToolbarボタンとショートカットが同じ実装を共有する（DRY）
- `TabBar.svelte` の `closeTab(id, path)`（`unwatch_path` 呼び出し + `tabStore.close` + `contentStore.delete`）を `tabStore.closeAndUnwatch(id)` として `tab.svelte.ts` に統合し、`TabBar.svelte` とコマンドの両方から呼べるようにする
- `tabStore` に `cycle(direction: 1 | -1)` と `jumpTo(index: number)` を追加（下記5.1）
- 設定パネルの開閉状態を `+page.svelte` のローカル `$state` から `app/src/lib/stores/ui.svelte.ts`（新規、非永続）の `uiStore` に移動する

---

## 5. 状態管理の変更

### 5.1 `tab.svelte.ts` への追加

```typescript
cycle(direction: 1 | -1) {
  if (tabs.length === 0) return;
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  const nextIdx = (idx + direction + tabs.length) % tabs.length;
  activeTabId = tabs[nextIdx].id;
},
jumpTo(index: number) {
  const tab = tabs[index];
  if (tab) activeTabId = tab.id;
},
async closeAndUnwatch(id: string) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  await invoke("unwatch_path", { path: tab.path }).catch(() => {});
  this.close(id);
  contentStore.delete(tab.path);
},
```

`closeAndUnwatch` は `invoke` と `contentStore` への依存が増えるため、`tab.svelte.ts` の冒頭で import する（既存の `TabBar.svelte` の import をそのまま移動）。

### 5.2 `ui.svelte.ts`（新規、非永続）

```typescript
function createUiStore() {
  let settingsPanelOpen = $state(false);

  return {
    get settingsPanelOpen() {
      return settingsPanelOpen;
    },
    openSettings() {
      settingsPanelOpen = true;
    },
    closeSettings() {
      settingsPanelOpen = false;
    },
  };
}

export const uiStore = createUiStore();
```

`+page.svelte` は `settingsOpen` ローカル変数を廃止し、`uiStore.settingsPanelOpen` を参照する。

---

## 6. グローバルキーリスナー

`+page.svelte` に `$effect` で登録する（既存の `file-changed` / `file-deleted` の `$effect` と同様のパターン）。

```typescript
$effect(() => {
  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.matches("input, textarea, [contenteditable='true']")) return;

    const combo = comboFromEvent(e);
    if (!combo) return;
    const commandId = keymap[combo];
    if (!commandId) return;

    e.preventDefault();
    runCommand(commandId);
  }

  window.addEventListener("keydown", handleKeydown);
  return () => window.removeEventListener("keydown", handleKeydown);
});
```

- `Escape` は `settings.close` にマッピングされているが、`uiStore.closeSettings()` は既に閉じている場合も安全に呼べる（冪等）ため、パネル未表示時のガード分岐は不要
- タブが1件もない場合の `tab.next` / `tab.prev` / `tab.jumpTo` は、`cycle` / `jumpTo` の実装内で早期returnするため無害（未決定事項の解消）

---

## 7. 未決定事項の解消

- **キー割り当ての最終確認**: 上記keymapで確定。`Ctrl+O` 等はTauri WebView2/WebKitGTKの既定動作と衝突しないため、`e.preventDefault()` は保険として実施
- **ヘルプUI**: v1では実装しない（対象外のまま）。将来 `listCommands()` を使えば一覧表示は追加しやすい設計になっている
- **タブなし時の挙動**: 無視（早期return）で確定

---

## 8. 残課題

なし。設計フェーズ完了。
