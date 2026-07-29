import type { Submenu } from "@tauri-apps/api/menu";
import { i18n } from "$lib/i18n/index.svelte";
import type { ReferenceFormat, ReferenceTarget } from "$lib/reference-copy";
import { copyReference } from "$lib/actions/reference-copy";

interface ReferenceMenuEntry {
  format: ReferenceFormat;
  text: string;
}

export function referenceMenuEntries(hasHeading: boolean): ReferenceMenuEntry[] {
  const m = i18n.m.referenceCopy;
  const entries: ReferenceMenuEntry[] = [
    { format: "wiki", text: m.wiki },
    { format: "markdown", text: m.markdown },
    { format: "path", text: m.path },
  ];
  if (hasHeading) {
    entries.push(
      { format: "heading-wiki", text: m.headingWiki },
      { format: "heading-markdown", text: m.headingMarkdown },
      { format: "heading-name", text: m.headingName }
    );
  }
  return entries;
}

async function createItems(target: ReferenceTarget) {
  const { MenuItem } = await import("@tauri-apps/api/menu");
  return Promise.all(
    referenceMenuEntries(Boolean(target.heading)).map((entry) =>
      MenuItem.new({
        text: entry.text,
        action: () => void copyReference(entry.format, target),
      })
    )
  );
}

export async function createReferenceSubmenu(target: ReferenceTarget): Promise<Submenu> {
  const { Submenu } = await import("@tauri-apps/api/menu");
  return Submenu.new({
    text: i18n.m.referenceCopy.menu,
    items: await createItems(target),
  });
}

export async function showHeadingReferenceMenu(
  event: MouseEvent,
  target: ReferenceTarget
): Promise<void> {
  event.preventDefault();
  try {
    const { Menu } = await import("@tauri-apps/api/menu");
    const menu = await Menu.new({ items: await createItems(target) });
    await menu.popup();
  } catch (error) {
    console.error("参照コピーメニューの表示に失敗しました:", error);
  }
}
