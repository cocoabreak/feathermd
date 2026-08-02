import { invoke } from "@tauri-apps/api/core";
import { settingsStore } from "$lib/stores/settings.svelte";

export type LocalFontSlot = "body" | "code";
export type LocalFontFormat = "woff2" | "ttf" | "otf";

export interface LocalFontInfo {
  originalFileName: string;
  format: LocalFontFormat;
  size: number;
}

export interface LocalFontSlotStatus {
  info: LocalFontInfo | null;
  error: string | null;
}

export interface LocalFontStatus {
  body: LocalFontSlotStatus;
  code: LocalFontSlotStatus;
}

const STYLE_ID = "local-font-style";
const CUSTOM_CSS_STYLE_ID = "custom-user-css";
const FAMILY_NAMES: Record<LocalFontSlot, string> = {
  body: "FeatherMD Local Body",
  code: "FeatherMD Local Code",
};
const EMPTY_SLOT_STATUS = (): LocalFontSlotStatus => ({ info: null, error: null });

let generation = 0;
let latestApply: Promise<void> = Promise.resolve();
let registeredFaces: Partial<Record<LocalFontSlot, FontFace>> = {};

function createRuntimeStore() {
  let status = $state<LocalFontStatus>({ body: EMPTY_SLOT_STATUS(), code: EMPTY_SLOT_STATUS() });
  let applied = $state<Record<LocalFontSlot, boolean>>({ body: false, code: false });
  let error = $state<string | null>(null);

  return {
    get status() {
      return status;
    },
    get applied() {
      return applied;
    },
    get error() {
      return error;
    },
    set(
      nextStatus: LocalFontStatus,
      nextApplied: Record<LocalFontSlot, boolean>,
      nextError: string | null
    ) {
      status = nextStatus;
      applied = nextApplied;
      error = nextError;
    },
  };
}

export const localFontsRuntimeStore = createRuntimeStore();

function clearRegisteredFaces(): void {
  for (const face of Object.values(registeredFaces)) {
    document.fonts.delete(face);
  }
  registeredFaces = {};
}

function updateStyle(faces: Partial<Record<LocalFontSlot, FontFace>>): void {
  const rules: string[] = [];
  if (faces.body) {
    rules.push(`.markdown-body {
  font-family: "${FAMILY_NAMES.body}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}`);
  }
  if (faces.code) {
    rules.push(`.markdown-body :where(pre, code, kbd, samp) {
  font-family: "${FAMILY_NAMES.code}", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}`);
  }

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (rules.length === 0) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    const customCss = document.getElementById(CUSTOM_CSS_STYLE_ID);
    document.head.insertBefore(style, customCss);
  }
  style.textContent = rules.join("\n\n");
}

async function loadFace(slot: LocalFontSlot): Promise<FontFace> {
  const bytes = await invoke<ArrayBuffer>("read_local_font", { slot });
  const face = new FontFace(FAMILY_NAMES[slot], bytes);
  return face.load();
}

async function applyGeneration(
  currentGeneration: number,
  preloadedFaces: Partial<Record<LocalFontSlot, FontFace>> = {}
): Promise<void> {
  let status: LocalFontStatus;
  try {
    status = await invoke<LocalFontStatus>("get_local_font_status");
  } catch (error) {
    if (currentGeneration !== generation) return;
    clearRegisteredFaces();
    updateStyle({});
    localFontsRuntimeStore.set(
      { body: EMPTY_SLOT_STATUS(), code: EMPTY_SLOT_STATUS() },
      { body: false, code: false },
      String(error)
    );
    return;
  }
  if (currentGeneration !== generation) return;

  if (!settingsStore.settings.localFontsEnabled) {
    clearRegisteredFaces();
    updateStyle({});
    localFontsRuntimeStore.set(status, { body: false, code: false }, null);
    return;
  }

  const nextFaces: Partial<Record<LocalFontSlot, FontFace>> = {};
  const nextStatus: LocalFontStatus = {
    body: { ...status.body },
    code: { ...status.code },
  };
  await Promise.all(
    (["body", "code"] as const).map(async (slot) => {
      if (!status[slot].info || status[slot].error) return;
      try {
        nextFaces[slot] = preloadedFaces[slot] ?? (await loadFace(slot));
      } catch (error) {
        nextStatus[slot] = { ...status[slot], error: String(error) };
      }
    })
  );
  if (currentGeneration !== generation) return;

  clearRegisteredFaces();
  for (const face of Object.values(nextFaces)) {
    document.fonts.add(face);
  }
  registeredFaces = nextFaces;
  updateStyle(nextFaces);
  localFontsRuntimeStore.set(nextStatus, { body: !!nextFaces.body, code: !!nextFaces.code }, null);
}

/** 最新世代だけをdocument.fontsとstyleへ確定し、遅い旧読込の上書きを防ぐ。 */
export function applyLocalFonts(
  preloadedFaces: Partial<Record<LocalFontSlot, FontFace>> = {}
): Promise<void> {
  const currentGeneration = ++generation;
  const run = applyGeneration(currentGeneration, preloadedFaces);
  latestApply = run.catch(() => {});
  return run;
}

export async function pickLocalFont(slot: LocalFontSlot): Promise<boolean> {
  const selected = await invoke<LocalFontInfo | null>("pick_local_font", { slot });
  if (!selected) return false;
  try {
    const bytes = await invoke<ArrayBuffer>("read_local_font_candidate", { slot });
    const face = await new FontFace(FAMILY_NAMES[slot], bytes).load();
    await invoke("commit_local_font_candidate", { slot });
    await applyLocalFonts({ [slot]: face });
    return true;
  } catch (error) {
    await invoke("discard_local_font_candidate", { slot }).catch(() => {});
    throw error;
  }
}

export async function removeLocalFont(slot: LocalFontSlot): Promise<void> {
  await invoke("remove_local_font", { slot });
  await applyLocalFonts();
}

/** 印刷前に最新適用とブラウザー内の全フォント読込を期限付きで待つ。 */
export async function waitForLocalFonts(timeoutMs = 3_000): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([
      (async () => {
        await latestApply;
        await document.fonts.ready;
      })(),
      deadline,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function startLocalFonts(): Promise<() => void> {
  await applyLocalFonts();
  return () => {
    generation++;
    clearRegisteredFaces();
    updateStyle({});
    localFontsRuntimeStore.set(
      { body: EMPTY_SLOT_STATUS(), code: EMPTY_SLOT_STATUS() },
      { body: false, code: false },
      null
    );
  };
}
