import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparePerformanceLaunch } from "./runner.mjs";
import { cleanupPerformanceWorkspace, createPerformanceWorkspace } from "./run-workspace.mjs";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "feathermd-workspace-test-"));
  const roaming = path.join(root, "roaming");
  const temp = path.join(root, "temp");
  mkdirSync(roaming);
  mkdirSync(temp);
  const plan = preparePerformanceLaunch(
    {
      port: 41_237,
      runDir: path.join(temp, "ignored"),
      executablePath: "C:\\build\\feathermd.exe",
      environment: {},
      platform: "win32",
    },
    {
      listProcesses: () => [],
      mutexExists: () => false,
      getRoamingAppData: () => roaming,
    }
  );
  return { root, roaming, temp, plan };
}

test("creates and removes owned profile and performance AppData", () => {
  const { root, temp, plan } = fixture();
  try {
    const workspace = createPerformanceWorkspace(plan, { tempRoot: temp });
    assert.equal(existsSync(workspace.profileDir), true);
    assert.equal(existsSync(workspace.performanceAppDataDir), true);
    assert.match(path.basename(workspace.runDir), /^feathermd-performance-run-/);
    cleanupPerformanceWorkspace(workspace);
    assert.equal(existsSync(workspace.runDir), false);
    assert.equal(existsSync(workspace.performanceAppDataDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("attempts both owned cleanup targets when the first removal fails", () => {
  const { root, temp, plan } = fixture();
  try {
    const workspace = createPerformanceWorkspace(plan, { tempRoot: temp });
    const attempted = [];
    assert.throws(
      () =>
        cleanupPerformanceWorkspace(workspace, {
          remove: (directory, options) => {
            attempted.push({ directory, options });
            throw new Error(`injected cleanup failure ${attempted.length}`);
          },
        }),
      AggregateError
    );
    assert.deepEqual(
      attempted.map(({ directory }) => directory),
      [workspace.runDir, workspace.performanceAppDataDir]
    );
    assert.ok(
      attempted.every(({ options }) => options.maxRetries === 10 && options.retryDelay === 180)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses cleanup after an owned directory is replaced", () => {
  const { root, temp, plan } = fixture();
  try {
    const workspace = createPerformanceWorkspace(plan, { tempRoot: temp });
    const moved = `${workspace.profileDir}-moved`;
    renameSync(workspace.profileDir, moved);
    mkdirSync(workspace.profileDir);
    assert.throws(() => cleanupPerformanceWorkspace(workspace), /ownership changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires a plan that passed existing-instance preflight", () => {
  const { root, temp, plan } = fixture();
  try {
    const unchecked = { ...plan };
    assert.throws(() => createPerformanceWorkspace(unchecked, { tempRoot: temp }), /preflight/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses existing performance AppData before creating a run directory", () => {
  const { root, temp, plan } = fixture();
  try {
    mkdirSync(plan.performanceAppDataDir);
    const before = readdirSync(temp);
    assert.throws(() => createPerformanceWorkspace(plan, { tempRoot: temp }), /already exists/);
    assert.deepEqual(readdirSync(temp), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rolls back owned directories when settings initialization fails", () => {
  const { root, temp, plan } = fixture();
  try {
    assert.throws(
      () =>
        createPerformanceWorkspace(plan, {
          tempRoot: temp,
          writeSettings: () => {
            throw new Error("injected settings failure");
          },
        }),
      /injected settings failure/
    );
    assert.deepEqual(readdirSync(temp), []);
    assert.equal(existsSync(plan.performanceAppDataDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("marks a workspace rollback failure unsafe for later trials", () => {
  const { root, temp, plan } = fixture();
  try {
    let error;
    try {
      createPerformanceWorkspace(plan, {
        tempRoot: temp,
        writeSettings: () => {
          throw new Error("injected settings failure");
        },
        remove: () => {
          throw new Error("injected rollback failure");
        },
      });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof AggregateError);
    assert.equal(error.performanceTrialContinuationSafe, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
