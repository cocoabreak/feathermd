import assert from "node:assert/strict";
import test from "node:test";
import {
  finishPerformanceLaunch,
  isProductionTauriUrl,
  measurePerformanceWorkspaceStartup,
} from "./measure.mjs";

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
  const firstReleaseError = new Error("first release failed");
  const repeatReleaseError = new Error("repeat release failed");
  const jobError = new Error("job failed");
  const workspaceError = new Error("workspace failed");
  const errors = await finishPerformanceLaunch(
    [
      { release: async () => Promise.reject(firstReleaseError) },
      { release: async () => Promise.reject(repeatReleaseError) },
    ],
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
  assert.deepEqual(errors, [repeatReleaseError, firstReleaseError, jobError, workspaceError]);
});

test("keeps workspace when fixture helper termination is unconfirmed", async () => {
  const unsafe = new Error("fixture helper is still running");
  const jobError = new Error("Job host reported a shutdown error");
  unsafe.performanceWorkspaceCleanupSafe = false;
  let cleaned = false;
  const errors = await finishPerformanceLaunch(
    [{ release: async () => Promise.reject(unsafe) }],
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

test("measures and closes one ready launch without cleaning its reusable workspace", async () => {
  const workspace = { id: "warm-workspace" };
  const job = { id: "warm-job" };
  let finished = false;
  const result = await measurePerformanceWorkspaceStartup(workspace, {
    launchReady: async (actualWorkspace) => {
      assert.equal(actualWorkspace, workspace);
      return { job, startupRequestedAt: 10, startupReadyAt: 25.125 };
    },
    finish: async (leases, actualJob, actualWorkspace, cleanupSafe) => {
      assert.deepEqual(leases, []);
      assert.equal(actualJob, job);
      assert.equal(actualWorkspace, undefined);
      assert.equal(cleanupSafe, true);
      finished = true;
      return [];
    },
  });
  assert.equal(finished, true);
  assert.deepEqual(result, { startupMs: 15.125 });
});

test("marks an unconfirmed reusable Job shutdown unsafe for workspace cleanup", async () => {
  const job = {
    terminationConfirmed: false,
    close: async () => {
      throw new Error("injected Job shutdown failure");
    },
  };
  await assert.rejects(
    measurePerformanceWorkspaceStartup(
      {},
      {
        launchReady: async () => ({ job, startupRequestedAt: 10, startupReadyAt: 20 }),
      }
    ),
    (error) =>
      error.performanceWorkspaceCleanupSafe === false &&
      error.performanceTrialContinuationSafe === false
  );
});

test("keeps reusable workspace cleanup safe after a confirmed trial shutdown failure", async () => {
  const error = new Error("confirmed shutdown failure");
  error.performanceTrialContinuationSafe = false;
  let receivedCleanupSafe;
  await assert.rejects(
    measurePerformanceWorkspaceStartup(
      {},
      {
        launchReady: async () => {
          throw error;
        },
        finish: async (leases, job, workspace, cleanupSafe) => {
          receivedCleanupSafe = cleanupSafe;
          return [];
        },
      }
    ),
    (actual) =>
      actual === error &&
      actual.performanceTrialContinuationSafe === false &&
      actual.performanceWorkspaceCleanupSafe !== false
  );
  assert.equal(receivedCleanupSafe, true);
});
