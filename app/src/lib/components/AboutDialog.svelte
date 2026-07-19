<script lang="ts">
  import { ExternalLink, X } from "@lucide/svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { focusTrap } from "$lib/actions/focus-trap";
  import { aboutBuildInfo, buildPluginEntries } from "$lib/about-info";
  import { i18n } from "$lib/i18n/index.svelte";
  import { viewerPlugins } from "$lib/plugins";
  import { settingsStore } from "$lib/stores/settings.svelte";
  import { updateCheckStore } from "$lib/stores/update-check.svelte";

  let { onclose }: { onclose: () => void } = $props();

  const GITHUB_URL = "https://github.com/cocoabreak/feathermd";
  const MIT_LICENSE_TEXT = `MIT License

Copyright (c) 2026 Hirofumi Akiyama

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

  const m = $derived(i18n.m);
  const plugins = $derived(buildPluginEntries(viewerPlugins, settingsStore.settings.renderers));
  const components = Object.values(aboutBuildInfo.components);

  function openGithub() {
    void openUrl(GITHUB_URL).catch((error) => {
      console.warn("GitHubリポジトリを開けませんでした:", error);
    });
  }

  function openReleases() {
    const state = updateCheckStore.state;
    if (state.status !== "available") return;
    void openUrl(state.releaseUrl).catch((error) => {
      console.warn("GitHub Releasesを開けませんでした:", error);
    });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="presentation"
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="about-dialog-title"
    tabindex="-1"
    use:focusTrap={{ onEscape: onclose }}
    class="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
  >
    <div class="flex shrink-0 items-center justify-between border-b px-4 py-3">
      <h2 id="about-dialog-title" class="text-sm font-semibold">{m.about.title}</h2>
      <button
        type="button"
        class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={m.common.close}
        onclick={onclose}
      >
        <X size={17} />
      </button>
    </div>

    <div class="overflow-y-auto p-5">
      <div class="flex items-center gap-4">
        <img src="/favicon.png" alt="" class="h-16 w-16 shrink-0" />
        <div class="min-w-0">
          <h3 class="text-2xl font-semibold tracking-tight">FeatherMD</h3>
          <p class="text-sm text-muted-foreground">
            {m.about.version(aboutBuildInfo.appVersion)}
          </p>
          <p class="mt-1 text-sm">{m.about.description}</p>
        </div>
      </div>

      <p class="mt-4 text-xs text-muted-foreground">{m.about.copyright}</p>
      <p
        class="mt-3 rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground"
      >
        {m.about.disclaimer}
      </p>
      <button
        type="button"
        class="mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        onclick={openGithub}
      >
        {m.about.github}
        <ExternalLink size={13} />
      </button>

      <div class="mt-3 rounded-md border bg-muted/20 p-3 text-xs">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-muted-foreground">
            {#if updateCheckStore.state.status === "checking"}
              {m.update.checking}
            {:else if updateCheckStore.state.status === "up-to-date"}
              {m.update.upToDate}
            {:else if updateCheckStore.state.status === "available"}
              {m.update.available(updateCheckStore.state.latestVersion)}
            {:else if updateCheckStore.state.status === "error"}
              {m.update.failed}
            {:else}
              {m.update.notChecked}
            {/if}
          </span>
          <div class="flex gap-2">
            {#if updateCheckStore.state.status === "available"}
              <button
                type="button"
                onclick={openReleases}
                class="inline-flex items-center gap-1 rounded border px-2 py-1 font-medium hover:bg-muted"
              >
                {m.update.openReleases}<ExternalLink size={12} />
              </button>
            {/if}
            <button
              type="button"
              disabled={updateCheckStore.state.status === "checking"}
              onclick={() => updateCheckStore.check({ force: true })}
              class="rounded border px-2 py-1 font-medium hover:bg-muted disabled:opacity-50"
            >
              {m.update.check}
            </button>
          </div>
        </div>
      </div>

      <div class="mt-5 space-y-3">
        <details class="rounded-md border">
          <summary class="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            {m.about.pluginsAndComponents}
          </summary>
          <div class="border-t px-3 py-3">
            <h4 class="text-xs font-semibold text-muted-foreground">
              {m.about.installedPlugins}
            </h4>
            <ul class="mt-2 divide-y">
              {#each plugins as plugin (plugin.name)}
                <li class="flex items-start justify-between gap-4 py-2 text-xs">
                  <div class="min-w-0">
                    <p class="font-medium">{plugin.displayName[i18n.locale]}</p>
                    <p class="text-muted-foreground">
                      {m.about.pluginVersion}
                      {plugin.version}
                      {#if plugin.engine}
                        · {m.about.engineVersion}
                        {plugin.engine.displayName}
                        {plugin.engine.version}
                      {/if}
                    </p>
                  </div>
                  <span
                    class="shrink-0 rounded-full px-2 py-0.5 {plugin.enabled
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'}"
                  >
                    {plugin.enabled ? m.about.enabled : m.about.disabled}
                  </span>
                </li>
              {/each}
            </ul>

            <h4 class="mt-4 text-xs font-semibold text-muted-foreground">
              {m.about.mainComponents}
            </h4>
            <ul class="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              {#each components as component (component.displayName)}
                <li class="flex justify-between gap-3">
                  <span>{component.displayName}</span>
                  <span class="text-muted-foreground">{component.version}</span>
                </li>
              {/each}
            </ul>
          </div>
        </details>

        <details class="rounded-md border">
          <summary class="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            {m.about.licenses}
          </summary>
          <div class="border-t px-3 py-3">
            <h4 class="text-xs font-semibold">{m.about.applicationLicense} — MIT</h4>
            <pre
              class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 text-[10px] leading-relaxed text-muted-foreground">{MIT_LICENSE_TEXT}</pre>

            <h4 class="mt-4 text-xs font-semibold">{m.about.thirdPartyLicenses}</h4>
            <ul class="mt-2 divide-y text-xs">
              {#each components as component (component.displayName)}
                <li class="flex justify-between gap-3 py-1.5">
                  <span>{component.displayName} {component.version}</span>
                  <span class="text-right text-muted-foreground">{component.license}</span>
                </li>
              {/each}
            </ul>
          </div>
        </details>
      </div>
    </div>
  </div>
</div>
