<script lang="ts">
  import {
    settingsStore,
    type AppTheme,
    type ExternalImagePolicy,
  } from "$lib/stores/settings.svelte";
  import { saveSettings } from "$lib/settings-store";
  import { reloadFolderTree } from "$lib/actions/explorer-actions";
  import { viewerPlugins } from "$lib/plugins";
  import { i18n, type LanguageSetting } from "$lib/i18n/index.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { applyCustomCss, customCssRuntimeStore } from "$lib/custom-css/custom-css.svelte";
  import { focusTrap } from "$lib/actions/focus-trap";
  import { onMount } from "svelte";

  interface ShellIntegrationStatus {
    supported: boolean;
    registered: boolean;
  }

  type SettingsCategory = "appearance" | "files" | "privacy" | "renderers";

  let { onclose }: { onclose: () => void } = $props();
  let activeCategory = $state<SettingsCategory>("appearance");
  let shellIntegrationStatus = $state<ShellIntegrationStatus | null>(null);
  let shellIntegrationBusy = $state(false);
  let shellIntegrationError = $state("");

  const m = $derived(i18n.m);
  const categories = $derived([
    { id: "appearance" as const, label: m.settings.view },
    { id: "files" as const, label: m.settings.files },
    { id: "privacy" as const, label: m.settings.privacy },
    { id: "renderers" as const, label: m.settings.renderers },
  ]);
  const activeCategoryLabel = $derived(
    categories.find((category) => category.id === activeCategory)?.label ?? m.settings.view
  );

  async function toggle(action: () => void) {
    action();
    await saveSettings();
  }

  async function changeLanguage(language: LanguageSetting) {
    await toggle(() => settingsStore.setLanguage(language));
    // ネイティブメニューも同じ言語で再構築する
    await invoke("set_menu_language", { locale: i18n.locale }).catch((e) => {
      console.warn("メニューの再構築に失敗しました:", e);
    });
  }

  async function browseEditor() {
    const path = await invoke<string | null>("pick_external_editor");
    if (path) {
      await toggle(() => settingsStore.setExternalEditorCommand(path));
    }
  }

  async function clearExternalEditor() {
    await invoke("clear_external_editor");
    await toggle(() => settingsStore.setExternalEditorCommand(""));
  }

  async function browseCustomCss() {
    const path = await invoke<string | null>("pick_custom_css");
    if (!path) return;
    settingsStore.setCustomCssPath(path);
    settingsStore.setCustomCssEnabled(true);
    await saveSettings();
    await applyCustomCss();
  }

  async function toggleCustomCss() {
    settingsStore.setCustomCssEnabled(!settingsStore.settings.customCssEnabled);
    await saveSettings();
    await applyCustomCss();
  }

  async function toggleStartupUpdateCheck() {
    await toggle(() =>
      settingsStore.setCheckForUpdatesOnStartup(!settingsStore.settings.checkForUpdatesOnStartup)
    );
  }

  async function clearCustomCss() {
    settingsStore.setCustomCssEnabled(false);
    settingsStore.setCustomCssPath("");
    await saveSettings();
    await applyCustomCss();
  }

  async function loadShellIntegrationStatus(preserveStatusOnError = false) {
    try {
      shellIntegrationStatus = await invoke<ShellIntegrationStatus>("get_shell_integration_status");
    } catch (error) {
      console.warn("Windows連携状態の取得に失敗しました:", error);
      if (!preserveStatusOnError) {
        // 非Windowsではコマンドがsupported=falseを正常に返すため、例外はWindows上の
        // 取得失敗として扱い、エラーを表示できる状態を維持する。
        shellIntegrationStatus = { supported: true, registered: false };
        shellIntegrationError = m.settings.windowsContextMenuError;
      }
    }
  }

  async function toggleShellIntegration(event: Event) {
    if (!shellIntegrationStatus?.supported || shellIntegrationBusy) return;
    const checkbox = event.currentTarget as HTMLInputElement;
    shellIntegrationBusy = true;
    shellIntegrationError = "";
    try {
      shellIntegrationStatus = await invoke<ShellIntegrationStatus>(
        "set_shell_integration_enabled",
        { enabled: !shellIntegrationStatus.registered }
      );
    } catch (error) {
      console.warn("Windows連携の変更に失敗しました:", error);
      shellIntegrationError = m.settings.windowsContextMenuError;
      // DOMのcheckboxも直前の実状態へ戻す。再取得まで失敗しても状態とエラーを残す。
      shellIntegrationStatus = { ...shellIntegrationStatus };
      await loadShellIntegrationStatus(true);
    } finally {
      if (shellIntegrationStatus) checkbox.checked = shellIntegrationStatus.registered;
      shellIntegrationBusy = false;
    }
  }

  onMount(() => {
    void loadShellIntegrationStatus();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="presentation"
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 print:hidden"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-dialog-title"
    tabindex="-1"
    use:focusTrap={{ onEscape: onclose }}
    class="flex h-[min(44rem,calc(100vh-2rem))] w-[min(56rem,calc(100vw-2rem))] flex-col rounded-lg border bg-background shadow-xl"
  >
    <div class="flex shrink-0 items-center justify-between border-b px-4 py-3">
      <h2 id="settings-dialog-title" class="text-sm font-semibold">{m.settings.title}</h2>
      <button
        onclick={onclose}
        class="rounded px-2 py-0.5 text-muted-foreground hover:text-foreground"
        aria-label={m.common.close}
      >
        ✕
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
      <nav
        aria-label={m.settings.categoryNavigation}
        class="flex shrink-0 overflow-x-auto border-b bg-muted/20 p-2 sm:w-44 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0"
      >
        {#each categories as category (category.id)}
          <button
            type="button"
            aria-current={activeCategory === category.id ? "page" : undefined}
            onclick={() => (activeCategory = category.id)}
            class="shrink-0 border-b-2 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground sm:border-b-0 sm:border-l-2 {activeCategory ===
            category.id
              ? 'border-primary bg-accent text-foreground'
              : 'border-transparent text-muted-foreground'}"
          >
            {category.label}
          </button>
        {/each}
      </nav>

      <main class="min-w-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">
        <h3 id="settings-category-title" class="mb-2 text-base font-semibold">
          {activeCategoryLabel}
        </h3>

        <div aria-labelledby="settings-category-title">
          {#if activeCategory === "appearance"}
            <details open class="group border-b py-2 last:border-b-0">
              <summary
                class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
              >
                {m.settings.application}
              </summary>
              <div class="pb-2">
                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">{m.settings.language}</span>
                  <select
                    value={settingsStore.settings.language}
                    onchange={(e) => changeLanguage(e.currentTarget.value as LanguageSetting)}
                    class="rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="system">{m.settings.languageSystem}</option>
                    <option value="ja">日本語</option>
                    <option value="en">English</option>
                  </select>
                </label>

                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">{m.settings.appTheme}</span>
                  <select
                    value={settingsStore.settings.theme}
                    onchange={(e) =>
                      toggle(() => settingsStore.setTheme(e.currentTarget.value as AppTheme))}
                    class="rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="system">{m.settings.themeSystem}</option>
                    <option value="light">{m.settings.themeLight}</option>
                    <option value="dark">{m.settings.themeDark}</option>
                  </select>
                </label>
              </div>
            </details>

            <details open class="group border-b py-2 last:border-b-0">
              <summary
                class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
              >
                {m.settings.codeBlocks}
              </summary>
              <div class="pb-2">
                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">{m.settings.codeTheme}</span>
                  <select
                    value={settingsStore.settings.codeTheme}
                    onchange={(e) =>
                      toggle(() => settingsStore.setCodeTheme(e.currentTarget.value))}
                    class="rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="dark-plus">Dark Plus</option>
                    <option value="light-plus">Light Plus</option>
                    <option value="github-dark">GitHub Dark</option>
                    <option value="github-light">GitHub Light</option>
                    <option value="dracula">Dracula</option>
                    <option value="nord">Nord</option>
                    <option value="one-dark-pro">One Dark Pro</option>
                  </select>
                </label>

                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">{m.settings.showLineNumbers}</span>
                  <input
                    type="checkbox"
                    checked={settingsStore.settings.showLineNumbers}
                    onchange={() => toggle(() => settingsStore.toggleLineNumbers())}
                    class="h-4 w-4 accent-primary"
                  />
                </label>
              </div>
            </details>

            <details open class="group border-b py-2 last:border-b-0">
              <summary
                class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
              >
                {m.settings.layout}
              </summary>
              <div class="pb-2">
                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">{m.settings.showSidebar}</span>
                  <input
                    type="checkbox"
                    checked={settingsStore.settings.sidebarVisible}
                    onchange={() => toggle(() => settingsStore.toggleSidebar())}
                    class="h-4 w-4 accent-primary"
                  />
                </label>

                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">{m.settings.showToc}</span>
                  <input
                    type="checkbox"
                    checked={settingsStore.settings.tocVisible}
                    onchange={() => toggle(() => settingsStore.toggleToc())}
                    class="h-4 w-4 accent-primary"
                  />
                </label>
              </div>
            </details>

            <details open class="group border-b py-2 last:border-b-0">
              <summary
                class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
              >
                {m.settings.customization}
              </summary>
              <div class="pb-2">
                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">
                    {m.settings.customCss}
                    <span class="ml-1 text-xs text-muted-foreground"
                      >{m.settings.customCssDescription}</span
                    >
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsStore.settings.customCssEnabled}
                    disabled={!settingsStore.settings.customCssPath}
                    onchange={toggleCustomCss}
                    class="h-4 w-4 accent-primary"
                  />
                </label>
                <div class="flex flex-wrap items-center gap-2 py-1.5">
                  <input
                    type="text"
                    readonly
                    value={settingsStore.settings.customCssPath}
                    placeholder={m.settings.customCssNotSelected}
                    title={settingsStore.settings.customCssPath}
                    class="min-w-48 flex-1 truncate rounded-md border border-input bg-muted/30 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    onclick={browseCustomCss}
                    class="whitespace-nowrap rounded-md border bg-muted px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    {m.settings.browse}
                  </button>
                  <button
                    type="button"
                    onclick={applyCustomCss}
                    disabled={!settingsStore.settings.customCssPath}
                    class="whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                  >
                    {m.settings.customCssReload}
                  </button>
                  <button
                    type="button"
                    onclick={clearCustomCss}
                    disabled={!settingsStore.settings.customCssPath}
                    class="whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                  >
                    {m.settings.customCssClear}
                  </button>
                </div>
                {#if customCssRuntimeStore.error}
                  <p class="mt-1 break-all text-xs text-destructive">
                    {m.settings.customCssError}: {customCssRuntimeStore.error}
                  </p>
                {:else if customCssRuntimeStore.applied}
                  <p class="mt-1 text-xs text-muted-foreground">
                    {m.settings.customCssSelected}
                  </p>
                {/if}
              </div>
            </details>
          {:else if activeCategory === "files"}
            <details open class="group border-b py-2 last:border-b-0">
              <summary
                class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
              >
                {m.settings.explorer}
              </summary>
              <div class="pb-2">
                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">{m.settings.showHiddenFiles}</span>
                  <input
                    type="checkbox"
                    checked={settingsStore.settings.showHiddenFiles}
                    onchange={() => toggle(() => settingsStore.toggleHiddenFiles())}
                    class="h-4 w-4 accent-primary"
                  />
                </label>

                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">
                    {m.settings.respectGitignore}
                    <span class="ml-1 text-xs text-muted-foreground"
                      >{m.settings.respectGitignoreNote}</span
                    >
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsStore.settings.respectGitignore}
                    onchange={async () => {
                      await toggle(() => settingsStore.toggleRespectGitignore());
                      await reloadFolderTree();
                    }}
                    class="h-4 w-4 accent-primary"
                  />
                </label>
              </div>
            </details>

            {#if shellIntegrationStatus?.supported}
              <details open class="group border-b py-2 last:border-b-0">
                <summary
                  class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
                >
                  {m.settings.windowsIntegration}
                </summary>
                <div class="pb-2">
                  <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                    <span class="text-sm">{m.settings.windowsContextMenu}</span>
                    <input
                      type="checkbox"
                      checked={shellIntegrationStatus.registered}
                      disabled={shellIntegrationBusy}
                      onchange={toggleShellIntegration}
                      class="h-4 w-4 accent-primary disabled:opacity-40"
                    />
                  </label>
                  <p class="text-xs text-muted-foreground">
                    {m.settings.windowsContextMenuDescription}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {m.settings.windowsContextMenuLegacyNote}
                  </p>
                  {#if shellIntegrationError}
                    <p class="mt-1 text-xs text-destructive" role="alert">
                      {shellIntegrationError}
                    </p>
                  {/if}
                </div>
              </details>
            {/if}

            <details open class="group border-b py-2 last:border-b-0">
              <summary
                class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
              >
                {m.settings.external}
              </summary>
              <div class="pb-2">
                <span class="mb-1 block text-sm">{m.settings.externalEditorCommand}</span>
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    readonly
                    value={settingsStore.settings.externalEditorCommand}
                    placeholder={m.settings.externalEditorPlaceholder}
                    class="min-w-48 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onclick={browseEditor}
                    class="whitespace-nowrap rounded-md border bg-muted px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
                  >
                    {m.settings.browse}
                  </button>
                  <button
                    type="button"
                    onclick={clearExternalEditor}
                    disabled={!settingsStore.settings.externalEditorCommand}
                    class="whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                  >
                    {m.settings.customCssClear}
                  </button>
                </div>
              </div>
            </details>
          {:else if activeCategory === "privacy"}
            <details open class="group border-b py-2 last:border-b-0">
              <summary
                class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
              >
                {m.settings.updates}
              </summary>
              <div class="pb-2">
                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">
                    {m.settings.checkForUpdatesOnStartup}
                    <span class="ml-1 text-xs text-muted-foreground"
                      >{m.settings.checkForUpdatesDescription}</span
                    >
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsStore.settings.checkForUpdatesOnStartup}
                    onchange={toggleStartupUpdateCheck}
                    class="h-4 w-4 accent-primary"
                  />
                </label>
              </div>
            </details>

            <details open class="group border-b py-2 last:border-b-0">
              <summary
                class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
              >
                {m.settings.externalContent}
              </summary>
              <div class="pb-2">
                <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                  <span class="text-sm">
                    {m.settings.externalImages}
                    <span class="ml-1 text-xs text-muted-foreground"
                      >{m.settings.externalImagesDescription}</span
                    >
                  </span>
                  <select
                    value={settingsStore.settings.externalImagePolicy}
                    onchange={(e) =>
                      toggle(() =>
                        settingsStore.setExternalImagePolicy(
                          e.currentTarget.value as ExternalImagePolicy
                        )
                      )}
                    class="shrink-0 rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="block">{m.settings.externalImagesBlock}</option>
                    <option value="ask">{m.settings.externalImagesAsk}</option>
                    <option value="allow">{m.settings.externalImagesAllow}</option>
                  </select>
                </label>
              </div>
            </details>
          {:else}
            <details open class="group border-b py-2 last:border-b-0">
              <summary
                class="cursor-pointer py-2 text-xs font-semibold text-muted-foreground marker:text-muted-foreground"
              >
                {m.settings.rendererPlugins}
              </summary>
              <div class="pb-2">
                {#each viewerPlugins as plugin (plugin.name)}
                  <label class="flex cursor-pointer items-center justify-between gap-4 py-1.5">
                    <span class="text-sm">
                      {plugin.displayName[i18n.locale]}
                      <span class="ml-1 text-xs text-muted-foreground"
                        >{plugin.description[i18n.locale]}</span
                      >
                    </span>
                    <input
                      type="checkbox"
                      checked={settingsStore.settings.renderers[plugin.name] ??
                        plugin.defaultEnabled}
                      onchange={() => toggle(() => settingsStore.toggleRenderer(plugin.name))}
                      class="h-4 w-4 accent-primary"
                    />
                  </label>
                {/each}
              </div>
            </details>
          {/if}
        </div>
      </main>
    </div>

    <div class="shrink-0 border-t px-4 py-3">
      <p class="text-xs text-muted-foreground">{m.settings.autoSaveNote}</p>
    </div>
  </div>
</div>
