import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { parseJobReady, queryPerformanceJobMembership, waitForHostExit } from "./windows-job.mjs";

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
