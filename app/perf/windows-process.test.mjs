import assert from "node:assert/strict";
import test from "node:test";
import {
  listProcessIdentities,
  assertOwnedCdpProcess,
  loopbackListenerQueryPlan,
  namedMutexExists,
  namedMutexQueryPlan,
  parseProcessIdentity,
  processIdentityQueryPlan,
  processDetailsQueryPlan,
  processListQueryPlan,
  queryRoamingAppData,
  queryProcessIdentity,
  queryLoopbackListenerOwner,
  queryProcessDetails,
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
  assert.match(plan.command, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
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

test("queries process command line and one loopback listener owner", () => {
  const detailPlan = processDetailsQueryPlan(4242);
  assert.match(detailPlan.args.at(-1), /CommandLine/);
  const details = queryProcessDetails(4242, () => ({
    status: 0,
    stdout: JSON.stringify({
      ...identity,
      commandLine:
        '"C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\msedgewebview2.exe" --remote-debugging-port=41237',
    }),
  }));
  assert.match(details.commandLine, /remote-debugging-port/);

  const listenerPlan = loopbackListenerQueryPlan(41_237);
  assert.match(listenerPlan.args.at(-1), /LocalAddress -eq '127\.0\.0\.1'/);
  assert.equal(
    queryLoopbackListenerOwner(41_237, () => ({ status: 0, stdout: "[5151]" })),
    5151
  );
  assert.throws(
    () => queryLoopbackListenerOwner(41_237, () => ({ status: 0, stdout: "[5151,5152]" })),
    /unambiguous owner/
  );
});

test("requires the CDP listener to be the app child with its port and profile", () => {
  const appIdentity = identity;
  const listenerProcess = {
    pid: 5151,
    parentPid: 4242,
    creationTime: identity.creationTime,
    executablePath:
      "c:\\program files (x86)\\microsoft\\edgewebview\\application\\msedgewebview2.exe",
    commandLine:
      'msedgewebview2.exe --remote-debugging-port=41237 --user-data-dir="C:\\temp\\profile"',
  };
  assert.equal(
    assertOwnedCdpProcess({
      appIdentity,
      listenerProcess,
      profileDir: "C:\\temp\\profile",
      port: 41_237,
    }).pid,
    5151
  );
  assert.throws(
    () =>
      assertOwnedCdpProcess({
        appIdentity,
        listenerProcess: { ...listenerProcess, parentPid: 9999 },
        profileDir: "C:\\temp\\profile",
        port: 41_237,
      }),
    /direct child/
  );
});
