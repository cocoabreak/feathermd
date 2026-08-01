import assert from "node:assert/strict";
import test from "node:test";
import {
  runColdTimingSuites,
  runFixtureTimingSuite,
  summarizeTimingTrials,
} from "./timing-suite.mjs";

test("summarizes exact trial values without changing their order", () => {
  assert.deepEqual(
    summarizeTimingTrials("startup-cold", [12, 9, 11, 10, 30], { expectedTrials: 5 }),
    {
      scenario: "startup-cold",
      status: "measured",
      trials: [12, 9, 11, 10, 30],
      medianMs: 11,
      minMs: 9,
      maxMs: 30,
    }
  );
  assert.throws(
    () => summarizeTimingTrials("startup-cold", [1, 2, 3, 4], { expectedTrials: 5 }),
    /requires 5 trials/
  );
});

test("runs isolated fixture trials and maps their timing scenarios", async () => {
  let calls = 0;
  const suite = await runFixtureTimingSuite({
    fixtureId: "plain-v1",
    trialCount: 2,
    includeColdStartup: true,
    measureTrial: async ({ fixtureId }) => {
      calls += 1;
      return {
        fixtureId,
        fixtureRendered: true,
        repeatFixtureRendered: true,
        timings: {
          startupColdMs: 100 + calls,
          readyToFixtureRequestMs: calls,
          firstRenderMs: 10 + calls,
          repeatRenderMs: 20 + calls,
        },
      };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(
    suite.timings.map(({ scenario, trials }) => ({ scenario, trials })),
    [
      { scenario: "startup-cold", trials: [101, 102] },
      { scenario: "ready-to-fixture-request-plain", trials: [1, 2] },
      { scenario: "first-render-plain", trials: [11, 12] },
      { scenario: "repeat-render-plain", trials: [21, 22] },
    ]
  );
});

test("records failed trials, runs every safe trial, and never summarizes a partial set", async () => {
  const calls = [];
  const result = await runColdTimingSuites({
    trialCount: 2,
    measureTrial: async ({ fixtureId }) => {
      calls.push(fixtureId);
      if (fixtureId === "plain-v1" && calls.length === 1) throw new Error("injected failure");
      return {
        fixtureId,
        fixtureRendered: true,
        repeatFixtureRendered: true,
        timings: {
          startupColdMs: 100,
          readyToFixtureRequestMs: 1,
          firstRenderMs: 2,
          repeatRenderMs: 3,
        },
      };
    },
  });
  assert.deepEqual(calls, ["plain-v1", "plain-v1", "rich-v1", "rich-v1"]);
  assert.deepEqual(result.suites[0].trials, [
    { trial: 1, status: "failed", reason: "Error" },
    { trial: 2, status: "measured" },
  ]);
  assert.ok(result.suites[0].timings.every((timing) => timing.status === "failed"));
  assert.ok(result.suites[0].timings.every((timing) => timing.trials === undefined));
  assert.ok(result.suites[1].timings.every((timing) => timing.status === "measured"));
});

test("records stable public-safe reasons for expected preflight failures", async () => {
  const suite = await runFixtureTimingSuite({
    fixtureId: "plain-v1",
    trialCount: 1,
    measureTrial: async () => {
      throw new Error("performance AppData already exists; refusing to overwrite it");
    },
  });
  assert.equal(suite.trials[0].reason, "PERFORMANCE_APPDATA_EXISTS");
});

test("waits for the current trial cleanup boundary before honoring interruption", async () => {
  const controller = new AbortController();
  let calls = 0;
  const suite = await runFixtureTimingSuite({
    fixtureId: "plain-v1",
    trialCount: 2,
    signal: controller.signal,
    measureTrial: async ({ fixtureId }) => {
      calls += 1;
      controller.abort();
      return {
        fixtureId,
        fixtureRendered: true,
        repeatFixtureRendered: true,
        timings: {
          startupColdMs: 100,
          readyToFixtureRequestMs: 1,
          firstRenderMs: 2,
          repeatRenderMs: 3,
        },
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(suite.interrupted, true);
  assert.equal(suite.trials.length, 1);
  assert.ok(suite.timings.every((timing) => timing.status === "failed"));
});

test("stops all later trials after an unsafe cleanup failure", async () => {
  let calls = 0;
  const result = await runColdTimingSuites({
    trialCount: 2,
    measureTrial: async () => {
      calls += 1;
      const error = new Error("injected unsafe cleanup");
      error.performanceTrialContinuationSafe = false;
      throw error;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.continuationSafe, false);
  assert.equal(result.suites.length, 1);
  assert.equal(result.suites[0].trials.length, 1);
});

test("keeps plain and rich in separate suites", async () => {
  const calls = [];
  const result = await runColdTimingSuites({
    trialCount: 2,
    measureTrial: async ({ fixtureId }) => {
      calls.push(fixtureId);
      return {
        fixtureId,
        fixtureRendered: true,
        repeatFixtureRendered: true,
        timings: {
          startupColdMs: 100,
          readyToFixtureRequestMs: 1,
          firstRenderMs: 2,
          repeatRenderMs: 3,
        },
      };
    },
  });
  assert.deepEqual(calls, ["plain-v1", "plain-v1", "rich-v1", "rich-v1"]);
  assert.equal(result.trialCount, 2);
  assert.deepEqual(
    result.timings.map((timing) => timing.scenario),
    [
      "startup-cold",
      "ready-to-fixture-request-plain",
      "first-render-plain",
      "repeat-render-plain",
      "ready-to-fixture-request-rich",
      "first-render-rich",
      "repeat-render-rich",
    ]
  );
});
