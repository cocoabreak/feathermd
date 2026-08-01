import assert from "node:assert/strict";
import test from "node:test";
import {
  listProcessIdentities,
  namedMutexExists,
  namedMutexQueryPlan,
  parseProcessIdentity,
  processIdentityQueryPlan,
  processListQueryPlan,
  queryRoamingAppData,
  queryProcessIdentity,
  roamingAppDataQueryPlan,
} from "./windows-process.mjs";

const identity = {
  pid: 4242,
  parentPid: 100,
  creationTime: "2026-08-01T01:02:03.0000000Z",
  executablePath: "c:\\build\\feathermd.exe",
};

test("queries one validated PID without invoking a shell", () => {
  const plan = processIdentityQueryPlan(4242);
  assert.equal(plan.command, "powershell.exe");
  assert.equal(plan.args.includes("4242"), false);
  assert.match(plan.args.at(-1), /ProcessId = 4242/);
  assert.equal(plan.options.shell, undefined);
  assert.throws(() => processIdentityQueryPlan(0), /PID/);
});

test("parses and normalizes a Windows process identity", () => {
  assert.deepEqual(
    parseProcessIdentity(
      JSON.stringify({
        pid: 4242,
        parentPid: 100,
        creationTime: "2026-08-01T01:02:03.0000000Z",
        executablePath: "C:\\Build\\feathermd.exe",
      })
    ),
    identity
  );
  assert.throws(() => parseProcessIdentity("not-json"), /invalid JSON/);
  assert.throws(
    () => parseProcessIdentity(JSON.stringify({ ...identity, executablePath: "relative.exe" })),
    /absolute/
  );
});

test("treats process-not-found as an absent identity", () => {
  const execute = () => ({ status: 3, stdout: "", stderr: "" });
  assert.equal(queryProcessIdentity(4242, execute), null);
});

test("lists only a validated executable name", () => {
  const plan = processListQueryPlan("feathermd.exe");
  assert.match(plan.args.at(-1), /Name = 'feathermd\.exe'/);
  assert.throws(() => processListQueryPlan("..\\feathermd.exe"), /name/);
  const execute = () => ({
    status: 0,
    stdout: JSON.stringify([identity, { ...identity, pid: 4243 }]),
  });
  assert.deepEqual(
    listProcessIdentities("feathermd.exe", execute).map((entry) => entry.pid),
    [4242, 4243]
  );
});

test("checks the exact Tauri single-instance mutex without creating it", () => {
  const plan = namedMutexQueryPlan("com.cocoabreak.feathermd-sim");
  assert.match(plan.args.at(-1), /OpenExisting\('com\.cocoabreak\.feathermd-sim'\)/);
  assert.throws(() => namedMutexQueryPlan("../other-sim"), /mutex name/);
  assert.equal(
    namedMutexExists("com.cocoabreak.feathermd-sim", () => ({ status: 0 })),
    true
  );
  assert.equal(
    namedMutexExists("com.cocoabreak.feathermd-sim", () => ({ status: 3 })),
    false
  );
});

test("uses the Windows Known Folder for Roaming AppData", () => {
  const plan = roamingAppDataQueryPlan();
  assert.match(plan.args.at(-1), /SpecialFolder.*ApplicationData/);
  assert.equal(
    queryRoamingAppData(() => ({
      status: 0,
      stdout: "C:\\Users\\alice\\AppData\\Roaming\r\n",
    })),
    "C:\\Users\\alice\\AppData\\Roaming"
  );
  assert.throws(
    () => queryRoamingAppData(() => ({ status: 0, stdout: "relative\n" })),
    /absolute path/
  );
});
