import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { i18n } from "$lib/i18n/index.svelte";
import { viewerPlugins } from "$lib/plugins";
import type { PostRenderContext } from "$lib/plugins";
import { tabStore } from "$lib/stores/tab.svelte";
import { explorerStore } from "$lib/stores/explorer.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import { areExternalImagesApprovedForDocument } from "$lib/stores/external-image-permission";

export const MAX_PNG_DIMENSION = 16_384;
export const MAX_PNG_PIXELS = 25_000_000;

export function validatePngDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_PNG_DIMENSION ||
    height > MAX_PNG_DIMENSION ||
    width * height > MAX_PNG_PIXELS
  ) {
    throw new Error("PNG image dimensions are too large");
  }
}

/**
 * 表示中のドキュメントを印刷する（PDF出力の入口。印刷ダイアログから
 * 「PDFとして保存」を選べる）。印刷前に各プラグインのbeforePrintを待ち、
 * 遅延レンダリング中の要素（画面外のMermaid図等）を完了させる。
 */
export async function printDocument() {
  const activeTab = tabStore.tabs.find((t) => t.id === tabStore.activeTabId);
  const container = document.querySelector<HTMLElement>(".markdown-body");
  if (!activeTab?.path || !container) return;

  const context: PostRenderContext = {
    document: activeTab.document ?? null,
    source: activeTab.source ?? null,
    filePath: activeTab.path,
    rootPath: explorerStore.rootPath,
    respectGitignore: settingsStore.settings.respectGitignore,
    locale: i18n.locale,
    externalImagesAllowed:
      settingsStore.settings.externalImagePolicy === "allow" ||
      (settingsStore.settings.externalImagePolicy === "ask" &&
        areExternalImagesApprovedForDocument(activeTab.path)),
  };
  for (const plugin of viewerPlugins) {
    if (!plugin.beforePrint) continue;
    try {
      await plugin.beforePrint(container, context);
    } catch (e) {
      console.warn(`plugin beforePrint error (${plugin.name}):`, e);
    }
  }

  // ダークテーマのまま印刷すると白背景に薄色文字で読めなくなるため、
  // 印刷プレビューの間だけライトテーマへ切り替える（window.print()は
  // ダイアログを閉じるまでブロックするので、finallyでの復元で足りる）
  const root = document.documentElement;
  const wasDark = root.classList.contains("dark");
  if (wasDark) root.classList.remove("dark");
  try {
    window.print();
  } finally {
    if (wasDark) root.classList.add("dark");
  }
}

/** エクスポートHTMLの<title>等へ埋め込む前に、テキストをHTMLエスケープする */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function saveAsHtml(title: string, renderedHtml: string) {
  try {
    // titleはファイル名由来の非制御文字列。生挿入すると `</title><script>` 等で
    // エクスポート先HTMLにスクリプト注入されうるためエスケープする（renderedHtmlは
    // レンダリング時にDOMPurifyでサニタイズ済み）。
    const safeTitle = escapeHtml(title);
    const htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #fff;
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
    }
    img, svg {
      max-width: 100%;
    }
    pre {
      background-color: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      overflow: auto;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #dfe2e5;
      padding: 6px 13px;
    }
    tr:nth-child(2n) {
      background-color: #f6f8fa;
    }
  </style>
</head>
<body class="markdown-body">
${renderedHtml}
</body>
</html>`;

    await invoke("save_text_export", {
      format: "html",
      suggestedName: title,
      contents: htmlContent,
    });
  } catch (err) {
    console.error("HTMLの保存に失敗:", err);
    await message(i18n.m.dialog.saveFailed(err), { title: i18n.m.common.error, kind: "error" });
  }
}

export async function saveAsSvg(svgElement: SVGSVGElement, title: string) {
  try {
    // Serialize SVG
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgElement);
    if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if (!source.match(/^<svg[^>]+"http:\/\/www\.w3\.org\/1999\/xlink"/)) {
      source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }
    source = '<?xml version="1.0" standalone="no"?>\r\n' + source;

    await invoke("save_text_export", {
      format: "svg",
      suggestedName: title,
      contents: source,
    });
  } catch (err) {
    console.error("SVGの保存に失敗:", err);
    await message(i18n.m.dialog.saveFailed(err), { title: i18n.m.common.error, kind: "error" });
  }
}

export async function saveAsPng(svgElement: SVGSVGElement, title: string) {
  try {
    // Mermaidの svg は width="100%" 等で固有サイズを持たないことがあるため、
    // 表示中の実寸をラスタライズサイズとして明示する
    const rect = svgElement.getBoundingClientRect();
    const width = Math.max(Math.round(rect.width), 1);
    const height = Math.max(Math.round(rect.height), 1);
    validatePngDimensions(width, height);
    const clone = svgElement.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(clone);
    if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // CSPのimg-srcはblob:を許可していない（tauri.conf.json）ため、
    // blob URLではなく許可済みのdata: URLとして読み込む
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Failed to load SVG image for PNG conversion"));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.width || width;
    canvas.height = img.height || height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context is not available");

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG Blob creation failed");

    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    await invoke("save_binary_export", {
      format: "png",
      suggestedName: title,
      contents: Array.from(uint8Array),
    });
  } catch (err) {
    console.error("PNGの保存に失敗:", err);
    await message(i18n.m.dialog.saveFailed(err), { title: i18n.m.common.error, kind: "error" });
  }
}
