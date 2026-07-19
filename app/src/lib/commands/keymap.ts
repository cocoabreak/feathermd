export const keymap: Record<string, string> = {
  "Ctrl+O": "file.open",
  "Ctrl+Shift+O": "file.openFolder",
  "Ctrl+W": "tab.close",
  "Ctrl+Shift+T": "tab.reopenClosed",
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
  "Alt+ArrowLeft": "nav.back",
  "Alt+ArrowRight": "nav.forward",
  "Ctrl+B": "panel.toggleSidebar",
  "Ctrl+J": "panel.toggleToc",
  "Ctrl+P": "quickOpen.open",
  "Ctrl+Shift+P": "commandPalette.open",
  "Ctrl+F": "search.open",
  "Ctrl+Shift+F": "globalSearch.open",
  "Ctrl+=": "view.zoomIn",
  "Ctrl++": "view.zoomIn",
  "Ctrl+Shift++": "view.zoomIn", // 主要キーボード配列でCtrl+Shift+=を押した場合（Shiftで"+"になる）を吸収
  "Ctrl+-": "view.zoomOut",
  "Ctrl+0": "view.zoomReset",
  "Ctrl+,": "settings.open",
  Escape: "settings.close",
};

export function shortcutForCommand(commandId: string): string | undefined {
  return Object.entries(keymap).find(([, id]) => id === commandId)?.[0];
}

export function isPickerCommand(commandId: string): boolean {
  return commandId === "quickOpen.open" || commandId === "commandPalette.open";
}

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
