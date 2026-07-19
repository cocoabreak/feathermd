import { afterEach, describe, expect, it } from "vitest";
import { pickerStore } from "./picker.svelte";

afterEach(() => pickerStore.close());

describe("pickerStore", () => {
  it("keeps only one picker mode open", () => {
    pickerStore.openQuickOpen();
    expect(pickerStore.mode).toBe("quickOpen");
    pickerStore.openCommandPalette();
    expect(pickerStore.mode).toBe("commandPalette");
    pickerStore.close();
    expect(pickerStore.mode).toBeNull();
  });
});
