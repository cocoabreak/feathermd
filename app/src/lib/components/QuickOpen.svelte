<script lang="ts">
  import PickerDialog from "$lib/components/PickerDialog.svelte";
  import { openSourceMarkdown } from "$lib/actions/file-actions";
  import {
    displayDocumentPath,
    documentKey,
    listSourceMarkdownDocuments,
  } from "$lib/document-sources";
  import { i18n } from "$lib/i18n/index.svelte";
  import type { PickerItem } from "$lib/picker/picker-match";
  import { explorerStore } from "$lib/stores/explorer.svelte";
  import { pickerStore } from "$lib/stores/picker.svelte";
  import { settingsStore } from "$lib/stores/settings.svelte";
  import type { DocumentRef } from "$lib/types";
  import { basename } from "$lib/utils";

  const m = $derived(i18n.m);
  let items = $state<PickerItem[]>([]);
  let documents = new Map<string, DocumentRef>();
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  $effect(() => {
    const source = explorerStore.source;
    void source?.generation;
    const showHiddenFiles = settingsStore.settings.showHiddenFiles;
    const respectGitignore = settingsStore.settings.respectGitignore;
    let disposed = false;

    items = [];
    documents = new Map();
    loadError = null;
    if (!source) {
      loading = false;
      return;
    }

    loading = true;
    void listSourceMarkdownDocuments(source.id, showHiddenFiles, respectGitignore)
      .then((result) => {
        if (disposed) return;
        const nextDocuments = new Map<string, DocumentRef>();
        const nextItems = result.map((document) => {
          const id = documentKey(document);
          nextDocuments.set(id, document);
          return {
            id,
            label: basename(document.path),
            detail: document.path,
          };
        });
        documents = nextDocuments;
        items = nextItems;
      })
      .catch((error) => {
        if (!disposed) loadError = m.picker.loadFailed(error);
      })
      .finally(() => {
        if (!disposed) loading = false;
      });

    return () => {
      disposed = true;
    };
  });

  async function openItem(item: PickerItem): Promise<void> {
    const document = documents.get(item.id);
    const source = explorerStore.source;
    if (!document || !source || document.sourceId !== source.id) return;

    pickerStore.close();
    try {
      await openSourceMarkdown(document, source);
    } catch (error) {
      alert(m.dialog.openFileFailed(displayDocumentPath(source, document), error));
    }
  }

  const emptyMessage = $derived(
    loadError ?? (explorerStore.source ? m.picker.noDocuments : m.picker.noExplorer)
  );
</script>

<PickerDialog
  title={m.picker.quickOpenTitle}
  placeholder={m.picker.quickOpenPlaceholder}
  {items}
  {loading}
  loadingMessage={m.picker.loading}
  {emptyMessage}
  noResultsMessage={m.picker.noResults}
  onselect={openItem}
  onclose={() => pickerStore.close()}
/>
