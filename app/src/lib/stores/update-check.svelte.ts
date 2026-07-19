import { invoke } from "@tauri-apps/api/core";

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export type UpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | ({ status: "up-to-date" } & UpdateCheckResult)
  | ({ status: "available" } & UpdateCheckResult)
  | { status: "error" };

type UpdateChecker = () => Promise<UpdateCheckResult>;

export function createUpdateCheckStore(
  checker: UpdateChecker = () => invoke<UpdateCheckResult>("check_for_updates")
) {
  let state = $state<UpdateCheckState>({ status: "idle" });
  let dismissedVersion = $state<string | null>(null);
  let activeRequest: Promise<void> | null = null;
  let reportActiveError = false;

  function applyResult(result: UpdateCheckResult) {
    state = {
      status: result.updateAvailable ? "available" : "up-to-date",
      ...result,
    };
  }

  async function check(options: { force?: boolean; silent?: boolean } = {}): Promise<void> {
    if (activeRequest) {
      if (!options.silent) reportActiveError = true;
      return activeRequest;
    }
    if (!options.force && state.status !== "idle" && state.status !== "error") return;

    const previousState = state;
    reportActiveError = !options.silent;
    state = { status: "checking" };
    activeRequest = checker()
      .then(applyResult)
      .catch((error: unknown) => {
        console.warn("更新を確認できませんでした:", error);
        state = reportActiveError ? { status: "error" } : previousState;
      })
      .finally(() => {
        activeRequest = null;
        reportActiveError = false;
      });
    return activeRequest;
  }

  return {
    get state() {
      return state;
    },
    get notificationVisible() {
      return state.status === "available" && dismissedVersion !== state.latestVersion;
    },
    check,
    dismissNotification() {
      if (state.status === "available") dismissedVersion = state.latestVersion;
    },
    setResultForE2e(result: UpdateCheckResult) {
      if (!import.meta.env.DEV) throw new Error("E2Eフックはdevビルドでのみ利用できます");
      applyResult(result);
    },
  };
}

export const updateCheckStore = createUpdateCheckStore();
