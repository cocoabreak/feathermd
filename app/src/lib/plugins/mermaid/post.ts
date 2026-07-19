import { addMermaidExpandButton } from "$lib/markdown/image-lightbox-trigger";
import type { Locale } from "$lib/i18n/index.svelte";
import { protectExternalImages } from "$lib/markdown/external-images";

// プラグイン自己完結の実行時文言（コアの辞書には載せない）
const MESSAGES: Record<Locale, { renderFailed: string }> = {
  ja: { renderFailed: "⚠ Mermaid レンダリング失敗（クリックでコードを表示）" },
  en: { renderFailed: "⚠ Mermaid rendering failed (click to show code)" },
};

let initialized = false;
let mermaidModule: typeof import("mermaid").default | null = null;

async function getMermaid() {
  if (!mermaidModule) {
    mermaidModule = (await import("mermaid")).default;
  }
  if (!initialized) {
    // securityLevelは既定の"strict"を明示する。"loose"はHTMLラベルやclickディレクティブを
    // 素通しするため、悪意あるMarkdown内のMermaidブロック経由でHTML注入が可能になる。
    // strictではMermaid内部のDOMPurifyがラベルを無害化する。
    mermaidModule.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "strict",
      // 構文エラー時はアプリ側でエラーUIを表示する。Mermaid既定のエラーSVGは
      // document.body直下の一時要素に描画され、例外経路で残ることがあるため抑止する。
      suppressErrorRendering: true,
    });
    initialized = true;
  }
  return mermaidModule;
}

const RENDER_TIMEOUT_MS = 8000;
const MAX_PRINT_DIAGRAMS = 100;
const PRINT_RENDER_CONCURRENCY = 2;

/** 単一のMermaid要素を描画する（タイムアウト付き） */
async function renderOne(
  el: HTMLElement,
  locale: Locale,
  externalImagesAllowed = false,
  onExternalImagesBlocked?: (count: number) => void
): Promise<void> {
  if (!el.classList.contains("mermaid-pending")) return;

  const code = decodeURIComponent(el.dataset.code ?? "");
  if (!code) return;

  el.classList.replace("mermaid-pending", "mermaid-processing");

  let renderId: string | undefined;
  try {
    const mermaid = await getMermaid();
    renderId = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // 孤立した一時要素をクリーンアップ
    document.getElementById(renderId)?.remove();

    // タイムアウト付きで描画（hangするダイアグラムへの対策）
    const { svg } = await Promise.race([
      mermaid.render(renderId, code),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Mermaid render timed out (${RENDER_TIMEOUT_MS}ms)`)),
          RENDER_TIMEOUT_MS
        )
      ),
    ]);

    const protectedResult = externalImagesAllowed
      ? { html: svg, blockedCount: 0 }
      : protectExternalImages(svg);
    el.innerHTML = protectedResult.html;
    if (protectedResult.blockedCount > 0) {
      onExternalImagesBlocked?.(protectedResult.blockedCount);
    }
    el.classList.replace("mermaid-processing", "mermaid-rendered");
    addMermaidExpandButton(el);
  } catch (e) {
    console.warn("Mermaid render error:", e);
    const rawCode = el.dataset.code ? decodeURIComponent(el.dataset.code) : "";
    el.innerHTML = `
      <details class="mermaid-error-container" style="border:1px solid #f87171;border-radius:4px;padding:0.5rem;margin:0.5rem 0">
        <summary style="cursor:pointer;font-size:0.75rem;color:#f87171">
          ${MESSAGES[locale].renderFailed}
        </summary>
        <pre style="font-size:0.75rem;margin-top:0.5rem;overflow-x:auto"></pre>
      </details>`;
    // rawCodeは攻撃者制御の文字列のためinnerHTMLに直接埋め込まず、textContentで挿入する
    el.querySelector("pre")!.textContent = rawCode;
    el.classList.replace("mermaid-processing", "mermaid-error-container");
  } finally {
    if (renderId) {
      // Mermaidは描画用に d${id}（strict）または i${id}（sandbox）を
      // document.body直下へ作る。構文エラーやタイムアウトでもレイアウトへ漏らさない。
      // ${id} 自体は成功時に返されるSVGのIDなので、ここでは削除しない。
      document.getElementById(`d${renderId}`)?.remove();
      document.getElementById(`i${renderId}`)?.remove();
    }
  }
}

/**
 * コンテナ内の未レンダリングのMermaid図をすべて即時レンダリングする。
 * 印刷（PDF出力）前に、画面外で遅延中の図が空のまま出力されるのを防ぐために使う。
 */
export async function renderAllPending(
  container: HTMLElement,
  locale: Locale,
  externalImagesAllowed = false,
  onExternalImagesBlocked?: (count: number) => void
): Promise<void> {
  const pending = [...container.querySelectorAll<HTMLElement>(".mermaid-pending")];
  const jobs = pending.slice(0, MAX_PRINT_DIAGRAMS);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const element = jobs[nextIndex++];
      if (!element) return;
      await renderOne(element, locale, externalImagesAllowed, onExternalImagesBlocked);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PRINT_RENDER_CONCURRENCY, jobs.length) }, () => worker())
  );
  if (pending.length > MAX_PRINT_DIAGRAMS) {
    console.warn(
      `Mermaid print rendering was limited to ${MAX_PRINT_DIAGRAMS} of ${pending.length} diagrams`
    );
  }
}

/**
 * コンテナ内の .mermaid-pending 要素を遅延レンダリングする。
 * IntersectionObserver でビューポートに近づいた時だけ描画するため、
 * 大量の図があってもUIをブロックしない。
 * @returns クリーンアップ関数
 */
export function setupLazyMermaid(
  container: HTMLElement,
  locale: Locale,
  externalImagesAllowed = false,
  onExternalImagesBlocked?: (count: number) => void
): () => void {
  const pending = container.querySelectorAll<HTMLElement>(".mermaid-pending");
  if (pending.length === 0) return () => {};

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          // イベントループを解放してからレンダリング
          setTimeout(
            () =>
              renderOne(
                entry.target as HTMLElement,
                locale,
                externalImagesAllowed,
                onExternalImagesBlocked
              ),
            0
          );
        }
      }
    },
    { rootMargin: "300px 0px", threshold: 0 } // 300px手前からプリレンダリング
  );

  pending.forEach((el) => observer.observe(el));

  return () => observer.disconnect();
}
