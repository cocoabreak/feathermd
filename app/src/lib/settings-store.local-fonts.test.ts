import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { loadSettings, saveSettings } from "$lib/settings-store";
import { settingsStore } from "$lib/stores/settings.svelte";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  settingsStore.setLocalFontsEnabled(false);
});

describe("local font settings persistence", () => {
  it("保存済みbooleanを復元し、現在値を保存する", async () => {
    invokeMock.mockResolvedValueOnce({ settings: { localFontsEnabled: true } });
    await loadSettings();
    expect(settingsStore.settings.localFontsEnabled).toBe(true);

    invokeMock.mockResolvedValueOnce(undefined);
    await saveSettings();
    expect(invokeMock).toHaveBeenLastCalledWith("save_app_state", {
      kind: "settings",
      value: { settings: expect.objectContaining({ localFontsEnabled: true }) },
    });
  });

  it("boolean以外の保存値を無視する", async () => {
    invokeMock.mockResolvedValueOnce({ settings: { localFontsEnabled: "yes" } });
    await loadSettings();
    expect(settingsStore.settings.localFontsEnabled).toBe(false);
  });
});
