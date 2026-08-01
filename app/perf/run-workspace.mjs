import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertPreparedPerformancePlan } from "./runner.mjs";

const RUN_PREFIX = "feathermd-performance-run-";
const WORKSPACE_OWNERSHIP = Symbol("performance workspace ownership");

function normalize(directory) {
  return path.win32.normalize(directory).toLowerCase();
}

function realDirectory(directory, label) {
  if (!path.win32.isAbsolute(directory)) throw new Error(`${label} must be absolute`);
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  return {
    path: path.win32.normalize(realpathSync.native(directory)),
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
  };
}

function assertSameDirectory(directory, expected, label) {
  const current = realDirectory(directory, label);
  if (
    normalize(current.path) !== normalize(expected.path) ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.birthtimeMs !== expected.birthtimeMs
  ) {
    throw new Error(`${label} ownership changed`);
  }
}

function assertDirectChild(parent, child, expectedName, label) {
  if (
    normalize(path.win32.dirname(child)) !== normalize(parent) ||
    path.win32.basename(child) !== expectedName
  ) {
    throw new Error(`${label} is not the expected direct child`);
  }
}

export function createPerformanceWorkspace(
  plan,
  { tempRoot = os.tmpdir(), writeSettings = writeFileSync, remove = rmSync } = {}
) {
  assertPreparedPerformancePlan(plan);
  const realTemp = realDirectory(tempRoot, "temporary root");
  const roamingRoot = realDirectory(
    path.win32.dirname(plan.performanceAppDataDir),
    "Roaming AppData"
  );
  assertDirectChild(
    roamingRoot.path,
    plan.performanceAppDataDir,
    plan.performanceIdentifier,
    "performance AppData"
  );
  if (existsSync(plan.performanceAppDataDir)) {
    throw new Error("performance AppData already exists; refusing to overwrite it");
  }

  let realRun;
  let realProfile;
  let realPerformanceAppData;
  try {
    const runDir = mkdtempSync(path.win32.join(realTemp.path, RUN_PREFIX));
    realRun = realDirectory(runDir, "performance run directory");
    assertDirectChild(realTemp.path, realRun.path, path.win32.basename(runDir), "run directory");

    const profileDir = path.win32.join(realRun.path, "webview-profile");
    mkdirSync(profileDir);
    realProfile = realDirectory(profileDir, "WebView profile");
    assertDirectChild(realRun.path, realProfile.path, "webview-profile", "WebView profile");

    mkdirSync(plan.performanceAppDataDir);
    realPerformanceAppData = realDirectory(plan.performanceAppDataDir, "performance AppData");
    assertDirectChild(
      roamingRoot.path,
      realPerformanceAppData.path,
      plan.performanceIdentifier,
      "performance AppData"
    );
    writeSettings(
      path.win32.join(realPerformanceAppData.path, "settings.json"),
      JSON.stringify({ settings: { checkForUpdatesOnStartup: false } })
    );
  } catch (error) {
    const cleanupErrors = [];
    for (const [directory, identity, label] of [
      [realPerformanceAppData?.path, realPerformanceAppData, "performance AppData"],
      [realRun?.path, realRun, "performance run directory"],
    ]) {
      if (!directory || !identity) continue;
      try {
        assertSameDirectory(directory, identity, label);
        remove(directory, { recursive: true, maxRetries: 10, retryDelay: 180 });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      const rollbackError = new AggregateError(
        cleanupErrors,
        "performance workspace rollback failed",
        {
          cause: error,
        }
      );
      rollbackError.performanceTrialContinuationSafe = false;
      throw rollbackError;
    }
    throw error;
  }

  return {
    ...plan,
    options: {
      ...plan.options,
      env: {
        ...plan.options.env,
        WEBVIEW2_USER_DATA_FOLDER: realProfile.path,
      },
    },
    runDir: realRun.path,
    profileDir: realProfile.path,
    performanceAppDataDir: realPerformanceAppData.path,
    ownership: {
      tempRoot: realTemp,
      runDir: realRun,
      profileDir: realProfile,
      performanceAppDataDir: realPerformanceAppData,
      roamingRoot,
    },
    [WORKSPACE_OWNERSHIP]: true,
  };
}

export function cleanupPerformanceWorkspace(workspace, { remove = rmSync } = {}) {
  if (workspace?.[WORKSPACE_OWNERSHIP] !== true) {
    throw new Error("performance workspace ownership is missing");
  }
  const { ownership } = workspace;
  assertSameDirectory(workspace.profileDir, ownership.profileDir, "WebView profile");
  assertSameDirectory(workspace.runDir, ownership.runDir, "performance run directory");
  assertSameDirectory(
    workspace.performanceAppDataDir,
    ownership.performanceAppDataDir,
    "performance AppData"
  );
  assertDirectChild(
    ownership.tempRoot.path,
    ownership.runDir.path,
    path.win32.basename(ownership.runDir.path),
    "run directory"
  );
  assertDirectChild(
    ownership.roamingRoot.path,
    ownership.performanceAppDataDir.path,
    workspace.performanceIdentifier,
    "performance AppData"
  );
  const errors = [];
  for (const directory of [workspace.runDir, workspace.performanceAppDataDir]) {
    try {
      remove(directory, { recursive: true, maxRetries: 10, retryDelay: 180 });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "performance workspace cleanup failed");
  }
}

export function assertOwnedPerformanceWorkspace(workspace) {
  if (workspace?.[WORKSPACE_OWNERSHIP] !== true) {
    throw new Error("performance workspace ownership is missing");
  }
  return workspace;
}
