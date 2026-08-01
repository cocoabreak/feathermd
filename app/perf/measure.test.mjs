import assert from "node:assert/strict";
import test from "node:test";
import { finishPerformanceLaunch, isProductionTauriUrl } from "./measure.mjs";

test("accepts only exact production Tauri origins", () => {
  for (const value of [
    "https://tauri.localhost/",
    "http://tauri.localhost/index.html",
    "tauri://localhost/",
  ]) {
    assert.equal(isProductionTauriUrl(value), true, value);
  }
  for (const value of [
    "https://tauri.localhost.example/",
    "tauri://localhost-other/",
    "https://tauri.localhost:4444/",
    "https://tauri.localhost/other",
    "https://tauri.localhost/?redirect=example.com",
    "https://example.com/tauri.localhost",
    "not-a-url",
  ]) {
    assert.equal(isProductionTauriUrl(value), false, value);
  }
});

test("collects lease, Job, and workspace cleanup failures", async () => {
  const releaseError = new Error("release failed");
  const jobError = new Error("job failed");
  const workspaceError = new Error("workspace failed");
  const errors = await finishPerformanceLaunch(
    { release: async () => Promise.reject(releaseError) },
    {
      terminationConfirmed: true,
      close: async () => Promise.reject(jobError),
    },
    {},
    true,
    () => {
      throw workspaceError;
    }
  );
  assert.deepEqual(errors, [releaseError, jobError, workspaceError]);
});

test("keeps workspace when fixture helper termination is unconfirmed", async () => {
  const unsafe = new Error("fixture helper is still running");
  const jobError = new Error("Job host reported a shutdown error");
  unsafe.performanceWorkspaceCleanupSafe = false;
  let cleaned = false;
  const errors = await finishPerformanceLaunch(
    { release: async () => Promise.reject(unsafe) },
    { terminationConfirmed: true, close: async () => Promise.reject(jobError) },
    {},
    true,
    () => {
      cleaned = true;
    }
  );
  assert.deepEqual(errors, [unsafe, jobError]);
  assert.equal(cleaned, false);
});
