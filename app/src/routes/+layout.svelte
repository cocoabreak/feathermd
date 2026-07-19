<script lang="ts">
  import "../app.css";
  import "katex/dist/katex.min.css";
  import type { Snippet } from "svelte";
  import { settingsStore } from "$lib/stores/settings.svelte";
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";

  let { children }: { children: Snippet } = $props();

  $effect(() => {
    const theme = settingsStore.settings.theme;
    if (typeof window === "undefined") return;

    const isDark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    void invoke("set_native_theme", { theme }).catch((error) => {
      console.warn("Failed to synchronize the native theme:", error);
    });
  });

  onMount(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (settingsStore.settings.theme === "system") {
        if (mediaQuery.matches) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      }
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  });
</script>

{@render children()}
