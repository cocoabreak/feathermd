import assert from "node:assert/strict";
import test from "node:test";
import { runMemoryMeasurementSuite } from "./memory-suite.mjs";

test("measures empty, plain, and rich in independent scenarios", async () => {
  const calls = [];
  const result = await runMemoryMeasurementSuite({
    measureScenario: async ({ scenario }) => {
      calls.push(scenario);
      return {
        scenario,
        status: "measured",
        processCount: 1,
        workingSetBytes: 100,
        privateMemoryBytes: 80,
        processes: [
          {
            pid: 100,
            parentPid: 1,
            name: "feathermd.exe",
            workingSet64: 100,
            privateMemorySize64: 80,
          },
        ],
      };
    },
  });
  assert.deepEqual(calls, ["empty", "plain", "rich"]);
  assert.deepEqual(
    result.memory.map(({ scenario, status }) => ({ scenario, status })),
    [
      { scenario: "empty", status: "measured" },
      { scenario: "plain", status: "measured" },
      { scenario: "rich", status: "measured" },
    ]
  );
});

test("keeps later scenarios after one launch failure with a public-safe code", async () => {
  const result = await runMemoryMeasurementSuite({
    measureScenario: async ({ scenario }) => {
      if (scenario === "plain") throw new Error("private path and process details");
      return { scenario, status: "not-measured", reason: "unstable-process-tree" };
    },
  });
  assert.deepEqual(result.memory, [
    { scenario: "empty", status: "not-measured", reason: "unstable-process-tree" },
    { scenario: "plain", status: "failed", error: "PerformanceMemoryScenarioError" },
    { scenario: "rich", status: "not-measured", reason: "unstable-process-tree" },
  ]);
  assert.equal(result.continuationSafe, true);
});

test("waits for the current scenario cleanup boundary before honoring interruption", async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await runMemoryMeasurementSuite({
    signal: controller.signal,
    measureScenario: async ({ scenario }) => {
      calls.push(scenario);
      controller.abort();
      return { scenario, status: "not-measured", reason: "unstable-process-tree" };
    },
  });
  assert.deepEqual(calls, ["empty"]);
  assert.equal(result.interrupted, true);
  assert.equal(result.continuationSafe, true);
});

test("stops later scenarios after an unsafe cleanup failure", async () => {
  const calls = [];
  const result = await runMemoryMeasurementSuite({
    measureScenario: async ({ scenario }) => {
      calls.push(scenario);
      const error = new Error("injected unsafe cleanup");
      error.performanceTrialContinuationSafe = false;
      throw error;
    },
  });
  assert.deepEqual(calls, ["empty"]);
  assert.equal(result.interrupted, false);
  assert.equal(result.continuationSafe, false);
  assert.deepEqual(result.memory, [
    { scenario: "empty", status: "failed", error: "PerformanceMemoryScenarioError" },
  ]);
});
