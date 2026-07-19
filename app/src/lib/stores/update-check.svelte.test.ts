import { describe, expect, it, vi } from "vitest";
import { createUpdateCheckStore, type UpdateCheckResult } from "./update-check.svelte";

const available: UpdateCheckResult = {
  currentVersion: "0.1.0",
  latestVersion: "0.2.0",
  updateAvailable: true,
  releaseUrl: "https://github.com/cocoabreak/feathermd/releases",
};

describe("updateCheckStore", () => {
  it("新版を共有状態と通知へ反映し、通知を閉じられる", async () => {
    const store = createUpdateCheckStore(async () => available);

    await store.check();

    expect(store.state).toMatchObject({ status: "available", latestVersion: "0.2.0" });
    expect(store.notificationVisible).toBe(true);
    store.dismissNotification();
    expect(store.notificationVisible).toBe(false);
  });

  it("同時確認を1リクエストへまとめる", async () => {
    let resolve!: (result: UpdateCheckResult) => void;
    const checker = vi.fn(() => new Promise<UpdateCheckResult>((done) => (resolve = done)));
    const store = createUpdateCheckStore(checker);

    const first = store.check();
    const second = store.check({ force: true });
    expect(checker).toHaveBeenCalledTimes(1);
    resolve({ ...available, latestVersion: "0.1.0", updateAvailable: false });
    await Promise.all([first, second]);

    expect(store.state.status).toBe("up-to-date");
  });

  it("自動確認の失敗は表示せず、手動確認の失敗は保持する", async () => {
    const store = createUpdateCheckStore(async () => {
      throw new Error("offline");
    });

    await store.check({ silent: true });
    expect(store.state.status).toBe("idle");

    await store.check({ force: true });
    expect(store.state).toEqual({ status: "error" });
  });

  it("自動確認中に手動確認された場合は失敗を表示する", async () => {
    let reject!: (error: Error) => void;
    const store = createUpdateCheckStore(
      () => new Promise<UpdateCheckResult>((_resolve, fail) => (reject = fail))
    );

    const automatic = store.check({ silent: true });
    const manual = store.check({ force: true });
    reject(new Error("offline"));
    await Promise.all([automatic, manual]);

    expect(store.state).toEqual({ status: "error" });
  });
});
