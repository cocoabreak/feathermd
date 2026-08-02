import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  acquirePerformanceWorkspaceLease,
  openPerformanceFixture,
  parseJobReady,
  queryPerformanceJobMembership,
  waitForHostExit,
} from "./windows-job.mjs";

test("parses only a valid Job-owned PID", () => {
  assert.deepEqual(parseJobReady('{"pid":4242}'), { pid: 4242 });
  for (const value of ["not-json", "{}", '{"pid":0}', '{"pid":"4242"}']) {
    assert.throws(() => parseJobReady(value), /Job host/);
  }
});

test("validates Job membership query results", () => {
  const jobName = "Local\\FeatherMD.Performance.01234567-89ab-cdef-0123-456789abcdef";
  assert.equal(
    queryPerformanceJobMembership(jobName, 4242, () => ({ status: 0, stdout: "true\r\n" })),
    true
  );
  assert.equal(
    queryPerformanceJobMembership(jobName, 4242, () => ({ status: 0, stdout: "false\r\n" })),
    false
  );
  assert.throws(() => queryPerformanceJobMembership("invalid", 4242), /Job name/);
});

test("rejects fixture delivery without owned workspace", async () => {
  const jobName = "Local\\FeatherMD.Performance.01234567-89ab-cdef-0123-456789abcdef";
  await assert.rejects(openPerformanceFixture({}, jobName, {}), /ownership/);
});

test("rejects workspace lease acquisition without owned workspace", async () => {
  await assert.rejects(acquirePerformanceWorkspaceLease({}), /ownership/);
});

test("native host confirms termination when Job assignment fails", () => {
  const source = readFileSync(new URL("./windows-job-host.cs", import.meta.url), "utf8");
  assert.match(
    source,
    /TerminateUnassignedProcess[\s\S]*TerminateProcess[\s\S]*WaitForSingleObject/
  );
  assert.equal(source.match(/TerminateUnassignedProcess\(process\.hProcess/g)?.length, 2);
});

test("native Job shutdown keeps handle ownership and never terminates by PID", () => {
  const source = readFileSync(new URL("./windows-job-host.cs", import.meta.url), "utf8");
  assert.match(
    source,
    /CreateProcess[\s\S]*CREATE_SUSPENDED[\s\S]*AssignProcessToJobObject\(job, process\.hProcess\)[\s\S]*ResumeThread\(process\.hThread\)/
  );
  assert.match(
    source,
    /TerminateJobObject\(job, 0\)[\s\S]*WaitForSingleObject\(process\.hProcess, INFINITE\) != WAIT_OBJECT_0[\s\S]*throw Error\("WaitForSingleObject failed after Job termination"\)/
  );
  assert.match(
    source,
    /WaitForJobEmpty[\s\S]*JOB_EMPTY_TIMEOUT_MS[\s\S]*QueryInformationJobObject[\s\S]*accounting\.ActiveProcesses == 0/
  );
  assert.match(source, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.doesNotMatch(source, /taskkill|Stop-Process/i);
});

test("native fixture lease holds a read-only shared handle until release", () => {
  const source = readFileSync(new URL("./windows-job-host.cs", import.meta.url), "utf8");
  assert.match(source, /FILE_SHARE_READ/);
  assert.match(source, /FILE_FLAG_OPEN_REPARSE_POINT/);
  assert.match(source, /FILE_FLAG_BACKUP_SEMANTICS/);
  assert.match(source, /GetFinalPathNameByHandle/);
  const script = readFileSync(new URL("./windows-job-open.ps1", import.meta.url), "utf8");
  assert.match(script, /Write-Output '\{"opened":true\}'[\s\S]*ReadLine[\s\S]*lease\.Dispose/);
});

test("native workspace lease holds all non-reparse directories until release", () => {
  const source = readFileSync(new URL("./windows-job-host.cs", import.meta.url), "utf8");
  assert.match(source, /OpenWorkspaceAndHold/);
  assert.match(source, /OpenVerifiedPath\(expectedRun, true\)/);
  assert.match(source, /OpenVerifiedPath\(expectedProfile, true\)/);
  assert.match(source, /OpenVerifiedPath\(appDataDirectory, true\)/);
  const script = readFileSync(new URL("./windows-workspace-lease.ps1", import.meta.url), "utf8");
  assert.match(script, /Write-Output '\{"leased":true\}'[\s\S]*ReadLine[\s\S]*lease\.Dispose/);
});

test("distinguishes confirmed termination from successful shutdown", async () => {
  const terminated = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: "SIGTERM",
  });
  await waitForHostExit(terminated, 10, "", { requireSuccess: false });
  await assert.rejects(
    waitForHostExit(terminated, 10, "", { requireSuccess: true }),
    /signal SIGTERM/
  );

  const running = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  const exit = waitForHostExit(running, 100, "", { requireSuccess: false });
  running.signalCode = "SIGTERM";
  running.emit("exit", null);
  await exit;
});
