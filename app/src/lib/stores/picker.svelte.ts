export type PickerMode = "quickOpen" | "commandPalette";

function createPickerStore() {
  let mode = $state<PickerMode | null>(null);

  return {
    get mode() {
      return mode;
    },
    openQuickOpen() {
      mode = "quickOpen";
    },
    openCommandPalette() {
      mode = "commandPalette";
    },
    close() {
      mode = null;
    },
  };
}

export const pickerStore = createPickerStore();
