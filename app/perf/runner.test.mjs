import assert from "node:assert/strict";
import test from "node:test";
import {
  createPerformanceLaunchPlan,
  preparePerformanceLaunch,
  resolveIdentifierAppDataDir,
} from "./runner.mjs";

const environment = {
  APPDATA: "D:\\untrusted-env-appdata",
  FEATHERMD_E2E_DISABLE_SINGLE_INSTANCE: "1",
  FEATHERMD_E2E_STATE_DIR: "C:\\temp\\e2e-state",
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-address=0.0.0.0",
  WEBVIEW2_USER_DATA_FOLDER: "C:\\normal-profile",
};
const roamingAppDataDir = "C:\\Users\\alice\\AppData\\Roaming";

test("resolves identifier AppData as a direct child of roaming AppData", () => {
  assert.equal(
    resolveIdentifierAppDataDir("com.cocoabreak.feathermd.performance", roamingAppDataDir),
    "C:\\Users\\alice\\AppData\\Roaming\\com.cocoabreak.feathermd.performance"
  );
  for (const identifier of ["../escape", "com.example..escape", "com/example/app"]) {
    assert.throws(() => resolveIdentifierAppDataDir(identifier, roamingAppDataDir), /identifier/);
  }
});

test("creates an argument-free isolated loopback launch plan", () => {
  const plan = createPerformanceLaunchPlan({
    port: 41_237,
    runDir: "C:\\temp\\feathermd-performance-run",
    executablePath: "C:\\build\\feathermd.exe",
    environment,
    platform: "win32",
    roamingAppDataDir,
  });

  assert.equal(plan.command, "C:\\build\\feathermd.exe");
  assert.deepEqual(plan.args, []);
  assert.equal(plan.cdpOrigin, "http://127.0.0.1:41237");
  assert.equal(
    plan.options.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
    "--remote-debugging-port=41237 --remote-debugging-address=127.0.0.1"
  );
  assert.equal(
    plan.options.env.WEBVIEW2_USER_DATA_FOLDER,
    "C:\\temp\\feathermd-performance-run\\webview-profile"
  );
  assert.equal(plan.options.env.FEATHERMD_E2E_DISABLE_SINGLE_INSTANCE, undefined);
  assert.equal(plan.options.env.FEATHERMD_E2E_STATE_DIR, undefined);
  assert.equal(plan.options.env.APPDATA, roamingAppDataDir);
  assert.notEqual(plan.normalAppDataDir, plan.performanceAppDataDir);
  assert.equal(plan.options.windowsHide, true);
});

test("rejects unsafe launch roots and CDP ports", () => {
  const base = {
    executablePath: "C:\\build\\feathermd.exe",
    environment,
    platform: "win32",
    roamingAppDataDir,
  };
  assert.throws(
    () => createPerformanceLaunchPlan({ ...base, port: 0, runDir: "C:\\temp\\run" }),
    /CDP port/
  );
  assert.throws(
    () => createPerformanceLaunchPlan({ ...base, port: 9_222, runDir: "relative" }),
    /absolute Windows path/
  );
  assert.throws(
    () =>
      createPerformanceLaunchPlan({
        ...base,
        port: 9_222,
        runDir: "C:\\Users\\alice\\AppData\\Roaming\\com.cocoabreak.feathermd.performance",
      }),
    /outside FeatherMD AppData/
  );
  assert.doesNotThrow(() =>
    createPerformanceLaunchPlan({
      ...base,
      port: 9_222,
      runDir: "E:\\performance\\run",
    })
  );
});

test("refuses launch when any FeatherMD instance already exists", () => {
  const options = {
    port: 41_237,
    runDir: "C:\\temp\\feathermd-performance-run",
    executablePath: "C:\\build\\feathermd.exe",
    environment,
    platform: "win32",
  };
  const dependencies = {
    listProcesses: () => [],
    mutexExists: () => false,
    getRoamingAppData: () => roamingAppDataDir,
  };
  assert.throws(
    () =>
      preparePerformanceLaunch(options, {
        ...dependencies,
        listProcesses: () => [{ pid: 1234 }],
      }),
    /already running/
  );
  assert.throws(
    () =>
      preparePerformanceLaunch(options, {
        ...dependencies,
        mutexExists: (name) => name === "com.cocoabreak.feathermd.performance-sim",
      }),
    /already running/
  );
  assert.deepEqual(preparePerformanceLaunch(options, dependencies).args, []);
});
