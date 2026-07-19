<script lang="ts">
  import PickerDialog from "$lib/components/PickerDialog.svelte";
  import { shortcutForCommand } from "$lib/commands/keymap";
  import { listPaletteCommands, runCommand } from "$lib/commands/registry";
  import { i18n } from "$lib/i18n/index.svelte";
  import type { PickerItem } from "$lib/picker/picker-match";
  import { pickerStore } from "$lib/stores/picker.svelte";

  const m = $derived(i18n.m);
  const items = $derived(
    listPaletteCommands().map((command) => ({
      id: command.id,
      label: command.label,
      detail: command.id,
      shortcut: shortcutForCommand(command.id),
    }))
  );

  function runItem(item: PickerItem): void {
    pickerStore.close();
    queueMicrotask(() => runCommand(item.id));
  }
</script>

<PickerDialog
  title={m.picker.commandPaletteTitle}
  placeholder={m.picker.commandPalettePlaceholder}
  {items}
  loadingMessage={m.picker.loading}
  emptyMessage={m.picker.noResults}
  noResultsMessage={m.picker.noResults}
  onselect={runItem}
  onclose={() => pickerStore.close()}
/>
