import { i18n } from "$lib/i18n/index.svelte";
import type { RenderMode, ViewMode } from "$lib/types";

interface ViewerContextMenuParams {
  event: MouseEvent;
  /** 右クリック位置の探索上限となるコンテンツルート要素 */
  contentEl: HTMLElement;
  activeTab: { nativePath?: string | null; canOpenExternalEditor: boolean; title: string };
  /** HTMLエクスポート用の描画済みHTML */
  renderedHtml: string;
  renderMode: RenderMode;
  viewMode?: ViewMode;
}

export function hasRenderedContextContent(renderMode: RenderMode, viewMode?: ViewMode): boolean {
  return renderMode === "full" && (viewMode ?? "rendered") === "rendered";
}

/** event.target から contentEl までを遡り、SVG要素上で右クリックされたかを判定する */
function findTargetSvg(event: MouseEvent, contentEl: HTMLElement): SVGSVGElement | null {
  let target = event.target as HTMLElement | null;
  while (target && target !== contentEl) {
    if (target.tagName?.toLowerCase() === "svg") {
      return target as unknown as SVGSVGElement;
    }
    target = target.parentElement;
  }
  return null;
}

/**
 * ビューア上の右クリックメニューを構築して表示する。
 * 通常表示のSVG上ではPNG/SVG保存を追加し、HTML保存も提供する。セーフモードでは
 * 描画済みHTML依存の項目を除外する。重いエクスポート系モジュールは表示時に動的importする。
 */
export async function showViewerContextMenu(params: ViewerContextMenuParams): Promise<void> {
  const { event, contentEl, activeTab, renderedHtml, renderMode, viewMode } = params;
  const m = i18n.m;
  const targetSvg = findTargetSvg(event, contentEl);
  const hasRenderedContent = hasRenderedContextContent(renderMode, viewMode);

  event.preventDefault();
  try {
    const { Menu, MenuItem, PredefinedMenuItem } = await import("@tauri-apps/api/menu");
    const { openExternalEditor } = await import("$lib/actions/file-actions");
    const { saveAsHtml, saveAsSvg, saveAsPng, printDocument } =
      await import("$lib/actions/export-actions");

    const items: (
      Awaited<ReturnType<typeof MenuItem.new>> | Awaited<ReturnType<typeof PredefinedMenuItem.new>>
    )[] = [
      await PredefinedMenuItem.new({ item: "Copy", text: m.contextMenu.copy }),
      await PredefinedMenuItem.new({ item: "SelectAll", text: m.contextMenu.selectAll }),
      await PredefinedMenuItem.new({ item: "Separator" }),
    ];

    if (hasRenderedContent && targetSvg) {
      items.push(
        await MenuItem.new({
          text: m.contextMenu.saveImagePng,
          action: () => saveAsPng(targetSvg, activeTab.title),
        }),
        await MenuItem.new({
          text: m.contextMenu.saveImageSvg,
          action: () => saveAsSvg(targetSvg, activeTab.title),
        }),
        await PredefinedMenuItem.new({ item: "Separator" })
      );
    }

    if (hasRenderedContent) {
      items.push(
        await MenuItem.new({
          text: m.contextMenu.saveAsHtml,
          action: () => saveAsHtml(activeTab.title, renderedHtml),
        })
      );
    }

    items.push(
      await MenuItem.new({
        text: m.contextMenu.print,
        action: () => printDocument(),
      }),
      await PredefinedMenuItem.new({ item: "Separator" })
    );
    if (activeTab.canOpenExternalEditor && activeTab.nativePath) {
      items.push(
        await MenuItem.new({
          text: m.contextMenu.openExternalEditor,
          action: () => openExternalEditor(activeTab.nativePath ?? undefined),
        })
      );
    }

    const menu = await Menu.new({ items });
    await menu.popup();
  } catch (err) {
    console.error("コンテキストメニューの表示に失敗しました:", err);
  }
}
