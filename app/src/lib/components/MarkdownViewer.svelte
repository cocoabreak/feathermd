<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { message } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { tabStore } from "$lib/stores/tab.svelte";
  import { contentStore } from "$lib/stores/content.svelte";
  import { settingsStore } from "$lib/stores/settings.svelte";
  import { explorerStore } from "$lib/stores/explorer.svelte";
  import { tocStore } from "$lib/stores/toc.svelte";
  import { readingStatsStore } from "$lib/stores/reading-stats.svelte";
  import { frontmatterStore } from "$lib/stores/frontmatter.svelte";
  import { recentStore } from "$lib/stores/recent.svelte";
  import { cancelMarkdownRender, renderMarkdown } from "$lib/markdown/engine";
  import { computeReadingStats } from "$lib/markdown/reading-stats";
  import { viewerPlugins } from "$lib/plugins";
  import { setupCodeCopy } from "$lib/markdown/code-copy";
  import { setupImageLightboxTrigger } from "$lib/markdown/image-lightbox-trigger";
  import { buildToc, scrollToAnchor } from "$lib/markdown/toc-dom";
  import { applyIntrinsicImageSize, hydrateLocalImages } from "$lib/markdown/local-images";
  import {
    approveLargeMarkdownFullRender,
    openMarkdownFile,
    openSourceMarkdown,
    resolveLocalPath,
  } from "$lib/actions/file-actions";
  import { authorizePath } from "$lib/actions/security";
  import { showViewerContextMenu } from "$lib/actions/context-menu";
  import { sessionRestorePromptStore } from "$lib/stores/session-restore-prompt.svelte";
  import { searchStore } from "$lib/stores/search.svelte";
  import { applyHighlights, clearHighlights } from "$lib/markdown/search-highlight";
  import { buildSearchResults } from "$lib/markdown/search-results";
  import { saveSettings } from "$lib/settings-store";
  import { saveRecent } from "$lib/recent-store";
  import { Archive, FilePlus, FolderOpen, X } from "@lucide/svelte";
  import { runCommand } from "$lib/commands/registry";
  import SearchBar from "./SearchBar.svelte";
  import SafeModeView from "./SafeModeView.svelte";
  import SourceView from "./SourceView.svelte";
  import { i18n } from "$lib/i18n/index.svelte";
  import { protectExternalImages } from "$lib/markdown/external-images";
  import {
    approveExternalImagesForDocument,
    areExternalImagesApprovedForDocument,
  } from "$lib/stores/external-image-permission";
  import { documentKey, nativeDocumentPath, resolveDocumentTarget } from "$lib/document-sources";
  import {
    sessionUiStateStore,
    shouldRestoreScroll,
    type ScrollViewMode,
  } from "$lib/stores/session-ui-state.svelte";

  const m = $derived(i18n.m);

  let contentEl: HTMLElement;
  let renderedHtml = $state("");
  let isLoading = $state(false);
  let currentMarks: HTMLElement[] = []; // 検索ハイライトの現在のmark要素（他のimperativeなDOMハンドルと同様、通常変数）
  let currentMarkedElement: HTMLElement | null = null;
  let searchGeneration = 0;
  let renderGeneration = 0;
  let externalImageCount = $state(0);
  let externalImageApprovalVersion = $state(0);

  // $state にすると $effect 内で変更時に再トリガーされ Mermaid が競合するため通常変数にする
  let prevViewKey: string | null = null;
  let suppressScrollRecording = false;
  let scrollRestoreGeneration = 0;
  let handledScrollRestoreVersion = 0;
  let observer: IntersectionObserver | null = null;
  // プラグインのDOM後処理（遅延Mermaid等）のクリーンアップ関数
  let cleanupPluginPostRender: (() => void)[] = [];
  // コードコピーのクリーンアップ関数
  let cleanupCodeCopy: (() => void) | null = null;
  // 画像ライトボックストリガーのクリーンアップ関数
  let cleanupImageLightbox: (() => void) | null = null;
  let cleanupLocalImages: (() => void) | null = null;
  // ファイルを開いた後にスクロールするアンカー
  let pendingAnchor: string | null = null;

  const activeTab = $derived(tabStore.tabs.find((t) => t.id === tabStore.activeTabId));
  const activeContent = $derived(activeTab ? contentStore.get(activeTab.path) : undefined);
  const isSafeMode = $derived((activeTab?.renderMode ?? "full") === "safe");
  const isSourceMode = $derived(!isSafeMode && (activeTab?.viewMode ?? "rendered") === "source");
  const scrollViewMode = $derived<ScrollViewMode>(
    isSafeMode ? "safe" : isSourceMode ? "source" : "rendered"
  );
  // レンダラーのON/OFFのみレンダリングに影響する。settingsStore.settings全体を
  // effect内で直接読むと、パネル幅などレンダリングに無関係な変更でも再レンダリングが
  // 走ってしまう（isLoading切り替えでスクロール位置が失われる）ため、$derivedの
  // 値変更検知（不変なら再通知しない性質）を挟んで依存範囲を絞る。renderersオブジェクトは
  // トグル時のみ新しい参照になるため、参照の同一性がそのまま変更検知として機能する。
  const rendererSettings = $derived(settingsStore.settings.renderers);
  const codeTheme = $derived(settingsStore.settings.codeTheme);
  const showLineNumbers = $derived(settingsStore.settings.showLineNumbers);
  const externalImagePolicy = $derived(settingsStore.settings.externalImagePolicy);

  function viewKeyFor(tab: typeof activeTab, mode: ScrollViewMode) {
    return tab ? `${tab.id}:${mode}` : null;
  }

  function scheduleScrollRestore(
    viewKey: string | null,
    tabId: string | undefined,
    mode: ScrollViewMode
  ): void {
    const generation = ++scrollRestoreGeneration;
    const savedPosition = untrack(() =>
      tabId ? (sessionUiStateStore.getScroll(tabId, mode) ?? 0) : 0
    );
    prevViewKey = viewKey;
    requestAnimationFrame(() => {
      if (generation !== scrollRestoreGeneration) return;
      if (contentEl) contentEl.scrollTop = savedPosition;
      requestAnimationFrame(() => {
        if (generation === scrollRestoreGeneration) suppressScrollRecording = false;
      });
    });
  }

  // 表示切替によるDOM差し替えがscrollTop=0のイベントを発生させても、
  // 切替前の保存位置を上書きしないようDOM更新前から記録を止める。
  $effect.pre(() => {
    const nextViewKey = viewKeyFor(activeTab, scrollViewMode);
    if (nextViewKey !== prevViewKey) suppressScrollRecording = true;
  });

  function cleanupDomEnhancements() {
    observer?.disconnect();
    observer = null;
    for (const cleanup of cleanupPluginPostRender) cleanup();
    cleanupPluginPostRender = [];
    cleanupCodeCopy?.();
    cleanupCodeCopy = null;
    cleanupImageLightbox?.();
    cleanupImageLightbox = null;
    cleanupLocalImages?.();
    cleanupLocalImages = null;
  }

  async function openRecentFile(path: string) {
    try {
      // 最近開いたファイル＝過去の明示操作なので、親フォルダを信頼ルートに再登録する
      if (!(await authorizePath(path))) return;
      await openMarkdownFile(path);
      // 直近履歴から開いたら、前回セッションの復元プロンプトは閉じる
      sessionRestorePromptStore.hide();
    } catch (err) {
      alert(m.dialog.openFileFailed(path, err));
    }
  }

  async function requestFullRender() {
    if (!activeTab) return;
    const target = { id: activeTab.id, path: activeTab.path };
    if (await approveLargeMarkdownFullRender(target.path)) {
      const current = tabStore.tabs.find((tab) => tab.id === target.id);
      if (current?.path === target.path) {
        tabStore.updateTab(target.id, { renderMode: "full", viewMode: "rendered" });
      }
    }
  }

  function allowExternalImagesForCurrentDocument() {
    const path = activeTab?.path;
    if (!path) return;
    approveExternalImagesForDocument(path);
    externalImageApprovalVersion++;
  }

  // コンテンツ・レンダラー設定変更時に再レンダリング
  $effect(() => {
    const generation = ++renderGeneration;
    // 言語切替でも再レンダリングし、後処理（プラグインの実行時文言）へ新しいlocaleを渡す
    void i18n.locale;
    const raw = activeContent?.raw;
    const safeMode = isSafeMode;
    const sourceMode = isSourceMode;
    const tabPath = activeTab?.path ?? "";
    const imagePolicy = externalImagePolicy;
    void externalImageApprovalVersion;
    const renderOptions = {
      // レンダリング中の設定変更に影響されないようスナップショットを渡す
      renderers: { ...rendererSettings },
      codeTheme,
      showLineNumbers,
    };

    if (!raw || safeMode || sourceMode) {
      cancelMarkdownRender();
      isLoading = false;
      renderedHtml = "";
      externalImageCount = 0;
      tocStore.setSafeOutline(
        activeContent?.safeOutline ?? [],
        activeContent?.safeOutlineTruncated ?? false
      );
      readingStatsStore.set(null);
      frontmatterStore.set(null);
      return;
    }

    isLoading = true;
    renderMarkdown(raw, renderOptions)
      .then((result) => {
        if (generation !== renderGeneration) return;
        const mayLoadExternalImages =
          imagePolicy === "allow" ||
          (imagePolicy === "ask" && areExternalImagesApprovedForDocument(tabPath));
        if (mayLoadExternalImages) {
          renderedHtml = result.html;
          externalImageCount = 0;
        } else {
          const protectedResult = protectExternalImages(result.html);
          renderedHtml = protectedResult.html;
          externalImageCount = protectedResult.blockedCount;
        }
        frontmatterStore.set(result.frontmatter);
        isLoading = false;
      })
      .catch((err) => {
        if (generation !== renderGeneration) return;
        console.error("[render] error:", err);
        renderedHtml = `<pre style="color:red;padding:1rem">${m.viewer.renderError(err)}</pre>`;
        isLoading = false;
      });
  });

  // DOM 更新後の後処理（isLoading も読んで、ローディング完了時に再トリガーされるようにする）
  $effect(() => {
    const html = renderedHtml;
    const loading = isLoading;
    const tab = activeTab;
    const safeMode = isSafeMode;
    const sourceMode = isSourceMode;
    const restoreVersion = sessionUiStateStore.restoreVersion;
    const restoredPositionsChanged = restoreVersion !== handledScrollRestoreVersion;
    handledScrollRestoreVersion = restoreVersion;
    const viewKey = viewKeyFor(tab, scrollViewMode);
    if (!contentEl) return;

    if (safeMode || sourceMode) {
      cleanupDomEnhancements();
      clearHighlights(contentEl);
      currentMarks = [];
      currentMarkedElement = null;
      tocStore.setSafeOutline(
        activeContent?.safeOutline ?? [],
        activeContent?.safeOutlineTruncated ?? false
      );
      tocStore.setActiveId(null);
      readingStatsStore.set(null);
      frontmatterStore.set(null);
      if (safeMode) {
        searchStore.setResult(0, null);
        searchStore.setResults([], false);
      }
      pendingAnchor = null;

      if (shouldRestoreScroll(viewKey, prevViewKey, restoredPositionsChanged)) {
        scheduleScrollRestore(viewKey, tab?.id, scrollViewMode);
      }
      return;
    }

    // ローディング中・HTML なし時は後処理しない
    if (loading || !html) {
      if (!html) {
        cleanupDomEnhancements();
        tocStore.setHeadings([]);
        readingStatsStore.set(null);
        frontmatterStore.set(null);
        if (viewKey === null) scheduleScrollRestore(null, undefined, scrollViewMode);
      }
      return;
    }

    // タブ切り替え時にスクロール位置を復元
    // （保存は常にonscroll={handleScroll}がリアルタイムに行っている。ここで改めて
    // contentEl.scrollTopを読むと、この時点で既にDOMが新タブの内容へ差し替わった後
    // のため、旧タブの位置としてほぼ0の値を誤って上書き保存してしまっていた）
    if (viewKey !== prevViewKey) {
      scheduleScrollRestore(viewKey, tab?.id, scrollViewMode);
    } else {
      // ファイル更新時：スクロール位置を維持
      const saved = untrack(() =>
        tab ? sessionUiStateStore.getScroll(tab.id, scrollViewMode) : undefined
      );
      if (saved !== undefined) {
        requestAnimationFrame(() => {
          if (contentEl) contentEl.scrollTop = saved;
        });
      }
    }

    // 見出しに ID を付与して TOC を構築
    const headings = buildToc(contentEl);
    tocStore.setHeadings(headings);
    readingStatsStore.set(computeReadingStats(contentEl));

    // IntersectionObserver でスクロール追随
    setupObserver(contentEl);

    // プラグインのDOM後処理（遅延Mermaid等）。前回分をクリーンアップしてから再セットアップ。
    // 無効なプラグインはfenceが動いておらずマーカー要素が存在しないため自然にno-opになる。
    // コンテキストはuntrackで読み、このエフェクトに不要な依存（設定変更での再実行）を足さない
    const postRenderGeneration = renderGeneration;
    const postRenderContext = untrack(() => ({
      document: tab?.document ?? null,
      source: tab?.source ?? null,
      filePath: tab?.path ?? null,
      rootPath: explorerStore.rootPath,
      respectGitignore: settingsStore.settings.respectGitignore,
      locale: i18n.locale,
      externalImagesAllowed:
        settingsStore.settings.externalImagePolicy === "allow" ||
        (settingsStore.settings.externalImagePolicy === "ask" &&
          areExternalImagesApprovedForDocument(tab?.path ?? "")),
      onExternalImagesBlocked: (count: number) => {
        if (tab?.path === activeTab?.path && renderGeneration === postRenderGeneration) {
          externalImageCount += count;
        }
      },
    }));
    for (const cleanup of cleanupPluginPostRender) cleanup();
    cleanupPluginPostRender = viewerPlugins.flatMap((plugin) => {
      if (!plugin.postRender) return [];
      try {
        const cleanup = plugin.postRender(contentEl, postRenderContext);
        return cleanup ? [cleanup] : [];
      } catch (e) {
        console.warn(`plugin postRender error (${plugin.name}):`, e);
        return [];
      }
    });

    cleanupCodeCopy?.();
    cleanupCodeCopy = setupCodeCopy(contentEl, {
      copy: m.viewer.copyCode,
      copied: m.viewer.sourceCopied,
    });

    cleanupImageLightbox?.();
    cleanupImageLightbox = setupImageLightboxTrigger(contentEl);

    // 画像の固有サイズ反映と、ローカル画像のデータURL化（信頼ルート内チェックはRust側）
    applyIntrinsicImageSize(contentEl);
    cleanupLocalImages?.();
    cleanupLocalImages =
      tab?.document && tab.source ? hydrateLocalImages(contentEl, tab.document, tab.source) : null;

    // ファイルを開いた際の保留アンカーにスクロール
    if (pendingAnchor) {
      const anchor = pendingAnchor;
      pendingAnchor = null;
      requestAnimationFrame(() => scrollToAnchor(contentEl, anchor));
    }
  });

  // 現在地マッチにクラス付けする。scroll=trueのときのみビューを動かす
  function markCurrentMatch(scroll: boolean) {
    currentMarkedElement?.classList.remove("search-match-current");
    const el = currentMarks[searchStore.currentIndex];
    currentMarkedElement = el ?? null;
    if (el) {
      el.classList.add("search-match-current");
      if (scroll) {
        // スクロール位置復元の requestAnimationFrame と競合して
        // スクロールがキャンセルされるのを防ぐため、少し遅らせて実行する
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    }
  }

  function selectClosestMarkToLine(line: number): void {
    if (currentMarks.length === 0) return;
    let bestIndex = 0;
    let minDiff = Infinity;
    for (let i = 0; i < currentMarks.length; i++) {
      const sourceEl = currentMarks[i].closest("[data-source-line]");
      const sourceLine = Number(sourceEl?.getAttribute("data-source-line"));
      if (!Number.isFinite(sourceLine)) continue;
      const diff = Math.abs(sourceLine - line);
      if (diff < minDiff) {
        minDiff = diff;
        bestIndex = i;
      }
    }
    searchStore.setCurrentIndex(bestIndex);
  }

  function selectMarkForResult(resultIndex: number, line: number): void {
    const marksWithLine = currentMarks.flatMap((mark, index) => {
      const sourceLine = Number(
        mark.closest("[data-source-line]")?.getAttribute("data-source-line")
      );
      return Number.isFinite(sourceLine) ? [{ index, line: sourceLine }] : [];
    });
    if (marksWithLine.length === 0) {
      if (currentMarks[resultIndex]) searchStore.setCurrentIndex(resultIndex);
      return;
    }

    const anchorLine = marksWithLine.reduce(
      (best, item) => (Math.abs(item.line - line) < Math.abs(best - line) ? item.line : best),
      marksWithLine[0].line
    );
    const group = marksWithLine.filter((item) => item.line === anchorLine);
    const nextAnchor = marksWithLine
      .map((item) => item.line)
      .filter((sourceLine) => sourceLine > anchorLine)
      .sort((a, b) => a - b)[0];
    const sourceResultIndices = searchStore.results.flatMap((result, index) =>
      result.line >= anchorLine && (nextAnchor === undefined || result.line < nextAnchor)
        ? [index]
        : []
    );
    const ordinal = Math.max(0, sourceResultIndices.indexOf(resultIndex));
    searchStore.setCurrentIndex(group[Math.min(ordinal, group.length - 1)].index);
  }

  // 前回の検索条件（タブ切り替えだけによる再走査かどうかの判定用。$stateにすると
  // このeffect自身の再トリガー要因になってしまうため通常変数にする）
  let prevSearchQuery = "";
  let prevUseRegex = false;
  let prevSearchOpen = false;

  // 検索語・正規表現モード・開閉・コンテンツ変更のたびに再走査
  // （上の後処理effectとは分離し、検索語入力のたびにスクロール復元やMermaid再セットアップが走らないようにする）
  $effect(() => {
    const generation = ++searchGeneration;
    const query = searchStore.query;
    const useRegex = searchStore.useRegex;
    const isOpen = searchStore.open;
    const loading = isLoading;
    const safeMode = isSafeMode;
    const sourceMode = isSourceMode;
    const rawForResults = activeContent?.raw ?? "";
    void renderedHtml; // タブ切り替え・ファイル更新時に再走査するための依存
    if (!contentEl || loading) return;

    // 検索条件自体（語句・正規表現モード・開閉）が変わった場合のみジャンプする。
    // タブ切り替えによる再走査では、既存のスクロール位置復元と競合しないよう
    // ハイライト・件数だけ更新しビューは動かさない。
    const searchParamsChanged =
      query !== prevSearchQuery || useRegex !== prevUseRegex || isOpen !== prevSearchOpen;
    prevSearchQuery = query;
    prevUseRegex = useRegex;
    prevSearchOpen = isOpen;

    clearHighlights(contentEl);
    currentMarks = [];
    currentMarkedElement = null;

    if (safeMode) {
      searchStore.setResult(0, null);
      searchStore.setResults([], false);
      return;
    }

    if (!isOpen || !query) {
      searchStore.setResult(0, null);
      searchStore.setResults([], false);
      return;
    }

    const searchRoot = sourceMode
      ? (contentEl.querySelector<HTMLElement>("[data-source-content]") ?? contentEl)
      : contentEl;

    void Promise.all([
      applyHighlights(searchRoot, query, useRegex, () => generation !== searchGeneration),
      buildSearchResults(rawForResults, query, useRegex),
    ]).then(([highlightResult, resultList]) => {
      if (generation !== searchGeneration) return;
      currentMarks = highlightResult.marks;
      searchStore.setResult(
        highlightResult.marks.length,
        highlightResult.error,
        highlightResult.truncated
      );
      searchStore.setResults(resultList.items, resultList.truncated);

      untrack(() => {
        if (searchStore.targetLine !== null && highlightResult.marks.length > 0) {
          selectClosestMarkToLine(searchStore.targetLine);
          searchStore.setTargetLine(null);
        }

        markCurrentMatch(searchParamsChanged);
      });
    });

    return () => {
      searchGeneration++;
    };
  });

  // 次候補/前候補（navVersion）でのみ発火。再走査はせずクラス付け替え＋スクロールのみ。
  // currentIndex自体を依存にすると、上のeffectのsetResult()による再走査時の
  // インデックス変更（例: タブ切り替え時の0リセット）でも誤って発火してしまうため、
  // next()/prev()の呼び出しでのみ増分するnavVersionを使う
  $effect(() => {
    void searchStore.navVersion;
    markCurrentMatch(true);
  });

  // 結果一覧のクリックは検索条件を変えず、指定行に最も近い既存markへ移動する。
  $effect(() => {
    void searchStore.resultSelectionVersion;
    const line = searchStore.selectedResultLine;
    if (line === null) return;
    selectMarkForResult(searchStore.selectedResultIndex, line);
    searchStore.clearSelectedResultLine();
    markCurrentMatch(true);
  });

  function setupObserver(container: HTMLElement) {
    observer?.disconnect();
    const els = container.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6");
    if (els.length === 0) return;

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            tocStore.setActiveId(entry.target.id || null);
            return;
          }
        }
      },
      { rootMargin: "-5% 0% -80% 0%", threshold: 0 }
    );

    els.forEach((el) => observer!.observe(el));
  }

  // リンクのクリックをインターセプト
  async function handleClick(event: MouseEvent) {
    const target = event.target as HTMLElement;

    const anchor = target.closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href) return;

    event.preventDefault();

    if (href.startsWith("http://") || href.startsWith("https://")) {
      openUrl(href);
    } else if (href.startsWith("#")) {
      // アンカーリンク：同一ファイル内スクロール
      scrollToAnchor(contentEl, href.slice(1));
    } else {
      // ローカルファイルリンク（#フラグメントを含む可能性あり）
      const hashIdx = href.indexOf("#");
      const filePart = hashIdx > 0 ? href.slice(0, hashIdx) : href;
      const hash = hashIdx > 0 ? href.slice(hashIdx + 1) : "";
      const tab = activeTab;
      if (!tab?.document || !tab.source) return;
      const currentPath = tab.path;
      const resolvedDocument = resolveDocumentTarget(tab.source, tab.document, filePart);

      // 同一ファイルへのリンクはアンカースクロールのみ
      if (resolvedDocument && documentKey(resolvedDocument) === currentPath && hash) {
        scrollToAnchor(contentEl, hash);
        return;
      }

      if (resolvedDocument) {
        if (hash) pendingAnchor = hash;
        openSourceMarkdown(resolvedDocument, tab.source).catch(async (err) => {
          pendingAnchor = null;
          await message(m.dialog.openFileFailed(resolvedDocument.path, err), {
            title: m.common.error,
            kind: "error",
          });
        });
        return;
      }

      // NativeSourceのルート外リンクだけは、従来どおり明示確認後に別NativeSourceとして開く。
      const nativePath = nativeDocumentPath(tab.source, tab.document);
      if (!nativePath || tab.source.kind !== "native") {
        await message(m.trust.rejected("アーカイブの外部へは移動できません"), {
          title: m.common.error,
          kind: "error",
        });
        return;
      }
      const resolved = resolveLocalPath(nativePath, filePart);

      // 信頼ルート外のリンクはRust側のネイティブ確認でのみ認可する。
      if (!(await invoke<boolean>("is_path_allowed", { path: resolved }))) {
        try {
          if (!(await authorizePath(resolved))) return;
        } catch (err) {
          await message(m.trust.rejected(err), {
            title: m.common.error,
            kind: "error",
          });
          return;
        }
      }

      if (hash) pendingAnchor = hash;
      openMarkdownFile(resolved).catch(async (err) => {
        pendingAnchor = null;
        await message(m.dialog.openFileFailed(resolved, err), {
          title: m.common.error,
          kind: "error",
        });
      });
    }
  }

  function handleContextMenu(event: MouseEvent) {
    const tab = tabStore.tabs.find((t) => t.id === tabStore.activeTabId);
    if (!tab?.path) return;
    void showViewerContextMenu({
      event,
      contentEl,
      activeTab: {
        nativePath:
          tab.document && tab.source ? nativeDocumentPath(tab.source, tab.document) : null,
        canOpenExternalEditor: !!tab.source?.capabilities.externalEditor,
        title: tab.title,
      },
      renderedHtml,
      renderMode: tab.renderMode ?? "full",
      viewMode: tab.viewMode ?? "rendered",
    });
  }

  function handleScroll() {
    if (!suppressScrollRecording && activeTab && contentEl) {
      sessionUiStateStore.setScroll(activeTab.id, scrollViewMode, contentEl.scrollTop);
    }
  }

  // Ctrl+ホイールでコンテンツの文字サイズをズームする
  let zoomSaveTimer: ReturnType<typeof setTimeout>;
  function handleWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) settingsStore.zoomIn();
    else if (e.deltaY > 0) settingsStore.zoomOut();

    clearTimeout(zoomSaveTimer);
    zoomSaveTimer = setTimeout(() => saveSettings(), 300);
  }

  onDestroy(() => {
    renderGeneration++;
    searchGeneration++;
    cancelMarkdownRender();
    cleanupDomEnhancements();
    clearTimeout(zoomSaveTimer);
  });
</script>

<div class="print-expand relative flex min-h-0 flex-1 flex-col">
  {#if searchStore.open}
    {#if isSafeMode}
      <div class="flex items-center justify-between border-b px-3 py-2 text-sm" role="status">
        <span>{m.viewer.safeModeSearchUnavailable}</span>
        <button
          type="button"
          class="rounded px-2 py-1 hover:bg-muted"
          onclick={() => searchStore.closeSearch()}>{m.common.close}</button
        >
      </div>
    {:else}
      <SearchBar />
    {/if}
  {/if}

  {#if externalImagePolicy === "ask" && externalImageCount > 0 && !isSafeMode && !isSourceMode}
    <div
      class="flex items-center justify-between gap-4 border-b bg-muted/50 px-4 py-2 text-sm"
      role="status"
    >
      <span>{m.viewer.externalImagesBlocked(externalImageCount)}</span>
      <button
        type="button"
        class="shrink-0 rounded border bg-background px-3 py-1.5 font-medium hover:bg-accent"
        onclick={allowExternalImagesForCurrentDocument}
      >
        {m.viewer.loadExternalImages}
      </button>
    </div>
  {/if}

  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={contentEl}
    role="main"
    class="print-expand markdown-body flex-1 overflow-y-auto px-8 py-6"
    class:selectable-content={!isLoading && !!activeContent}
    style="scrollbar-gutter: stable; font-size: {settingsStore.settings.contentZoom}%"
    onclick={handleClick}
    oncontextmenu={handleContextMenu}
    onscroll={handleScroll}
    onwheel={handleWheel}
  >
    {#if isLoading}
      <div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
        {m.common.loading}
      </div>
    {:else if isSafeMode && activeContent}
      <SafeModeView
        raw={activeContent.raw}
        headings={activeContent.safeOutline}
        onRequestFull={requestFullRender}
      />
    {:else if isSourceMode && activeContent}
      <SourceView raw={activeContent.raw} headings={activeContent.safeOutline} />
    {:else if activeContent}
      {@html renderedHtml}
    {:else}
      <div class="flex h-full items-start justify-center pt-20 text-muted-foreground">
        <div class="w-full max-w-md px-6 text-sm">
          <p class="text-center">{m.viewer.openFilePrompt}</p>
          <div class="my-4 flex justify-center gap-2">
            <button
              class="inline-flex items-center gap-1.5 rounded border bg-background px-3 py-2 text-foreground hover:bg-muted"
              onclick={() => runCommand("file.open")}
              ><FilePlus size={16} />{m.common.openFile}</button
            >
            <button
              class="inline-flex items-center gap-1.5 rounded border bg-background px-3 py-2 text-foreground hover:bg-muted"
              onclick={() => runCommand("file.openFolder")}
              ><FolderOpen size={16} />{m.common.openFolder}</button
            >
            <button
              class="inline-flex items-center gap-1.5 rounded border bg-background px-3 py-2 text-foreground hover:bg-muted"
              onclick={() => runCommand("file.openArchive")}
              ><Archive size={16} />{m.common.openArchive}</button
            >
          </div>
          <p class="mb-6 text-center text-xs">{m.viewer.dropPrompt}</p>
          {#if recentStore.files.length > 0}
            <p class="mb-2 text-center">{m.viewer.recentFiles}</p>
            <ul>
              {#each recentStore.files as file (file.path)}
                <li class="group relative">
                  <button
                    class="absolute right-0 top-1/2 -translate-y-1/2 p-1 opacity-0 hover:text-foreground group-hover:opacity-100"
                    title={m.common.removeFromHistory}
                    aria-label={m.common.removeFromHistory}
                    onclick={() => {
                      recentStore.removeFile(file.path);
                      void saveRecent();
                    }}
                  >
                    <X size={14} />
                  </button>
                  <button
                    class="w-full truncate py-1 pl-2 pr-7 text-left hover:bg-accent"
                    title={file.path}
                    onclick={() => openRecentFile(file.path)}
                  >
                    {file.title}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    font-weight: 600;
    line-height: 1.25;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
  }

  .markdown-body :global(h1) {
    font-size: 2em;
    border-bottom: 1px solid hsl(var(--border));
    padding-bottom: 0.3em;
  }
  .markdown-body :global(h2) {
    font-size: 1.5em;
    border-bottom: 1px solid hsl(var(--border));
    padding-bottom: 0.3em;
  }
  .markdown-body :global(h3) {
    font-size: 1.25em;
  }
  .markdown-body :global(h4) {
    font-size: 1em;
  }

  .markdown-body :global(p) {
    margin-bottom: 1rem;
    line-height: 1.75;
  }

  .markdown-body :global(img) {
    display: inline;
  }

  .markdown-body :global(a) {
    color: hsl(221, 83%, 53%);
    text-decoration: underline;
    cursor: pointer;
  }
  .markdown-body :global(a:hover) {
    opacity: 0.8;
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    padding-left: 1.5rem;
    margin-bottom: 1rem;
  }
  .markdown-body :global(ul) {
    list-style-type: disc;
  }
  .markdown-body :global(ol) {
    list-style-type: decimal;
  }
  .markdown-body :global(ul ul) {
    list-style-type: circle;
  }
  .markdown-body :global(ul ul ul) {
    list-style-type: square;
  }
  .markdown-body :global(li) {
    margin-bottom: 0.25rem;
    line-height: 1.75;
  }

  .markdown-body :global(blockquote) {
    border-left: 4px solid hsl(var(--border));
    padding-left: 1rem;
    margin: 1rem 0;
    color: hsl(var(--muted-foreground));
  }

  .markdown-body :global(code:not(pre code)) {
    background-color: hsl(var(--muted));
    border-radius: 3px;
    font-size: 0.875em;
    padding: 0.2em 0.4em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .markdown-body :global(.shiki) {
    padding: 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.875em;
    line-height: 1.6;
    overflow-x: auto;
  }

  .markdown-body :global(pre.line-numbers) {
    counter-reset: step;
    counter-increment: step 0;
  }

  .markdown-body :global(pre.line-numbers .line::before) {
    content: counter(step);
    counter-increment: step;
    width: 1.5rem;
    display: inline-block;
    text-align: right;
    margin-right: 1rem;
    color: rgba(115, 138, 148, 0.4);
    user-select: none;
  }

  .markdown-body :global(.code-block-wrapper) {
    position: relative;
  }
  .markdown-body :global(.code-copy-button) {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem;
    border-radius: 0.25rem;
    color: #d4d4d4;
    background: rgba(255, 255, 255, 0.1);
    opacity: 0;
    transition: opacity 0.15s;
    cursor: pointer;
    white-space: nowrap;
  }
  .markdown-body :global(.code-block-wrapper:hover .code-copy-button) {
    opacity: 1;
  }
  .markdown-body :global(.code-copy-button:hover) {
    background: rgba(255, 255, 255, 0.2);
  }
  .markdown-body :global(.code-copy-button.code-copy-success) {
    color: #4ade80;
    opacity: 1;
  }
  .markdown-body :global(.code-copy-icon svg) {
    display: block;
  }
  .markdown-body :global(.code-copy-message) {
    font-size: 0.75rem;
    line-height: 1;
  }

  .markdown-body :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
    font-size: 0.875em;
  }
  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid hsl(var(--border));
    padding: 0.5rem 0.75rem;
    text-align: left;
  }
  .markdown-body :global(th) {
    background-color: hsl(var(--muted));
    font-weight: 600;
  }
  .markdown-body :global(tr:nth-child(even) td) {
    background-color: hsl(var(--muted) / 0.4);
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid hsl(var(--border));
    margin: 1.5rem 0;
  }

  .markdown-body :global(.task-list-item) {
    list-style: none;
    margin-left: -1.5rem;
  }
  .markdown-body :global(.task-list-item input) {
    margin-right: 0.5rem;
  }

  .markdown-body :global(dl) {
    margin-bottom: 1rem;
  }
  .markdown-body :global(dt) {
    font-weight: 600;
  }
  .markdown-body :global(dd) {
    margin: 0.25rem 0 0.75rem 1.5rem;
  }

  .markdown-body :global(.footnotes) {
    color: hsl(var(--muted-foreground));
    font-size: 0.875em;
  }
  .markdown-body :global(.footnotes-list) {
    margin-bottom: 0;
  }
  .markdown-body :global(.footnote-ref),
  .markdown-body :global(.footnote-backref) {
    white-space: nowrap;
  }

  .markdown-body :global(.mermaid-rendered) {
    position: relative;
    display: flex;
    justify-content: center;
    margin: 1rem 0;
  }
  .markdown-body :global(.mermaid-rendered svg) {
    max-width: 100%;
  }
  .markdown-body :global(.mermaid-rendered .nodeLabel p) {
    line-height: 1.5;
  }

  .markdown-body :global(.lightbox-trigger-wrapper) {
    position: relative;
    display: inline-block;
  }
  .markdown-body :global(.lightbox-trigger-button) {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    padding: 0.25rem;
    border-radius: 0.25rem;
    color: #fff;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    transition: opacity 0.15s;
    cursor: pointer;
  }
  .markdown-body :global(.lightbox-trigger-wrapper:hover .lightbox-trigger-button),
  .markdown-body :global(.mermaid-rendered:hover .lightbox-trigger-button) {
    opacity: 1;
  }

  .markdown-body :global(mark.search-match) {
    background-color: hsl(48, 96%, 68%);
    color: inherit;
    border-radius: 2px;
  }
  .markdown-body :global(mark.search-match-current) {
    background-color: hsl(24, 94%, 58%);
  }
</style>
