import assert from "node:assert/strict";
import test from "node:test";
import {
  runColdTimingSuites,
  runFixtureTimingSuite,
  runWarmStartupSuite,
  summarizeTimingTrials,
} from "./timing-suite.mjs";

function startupPhaseTimings(value = 1) {
  return {
    startupProcessMs: value,
    startupCdpListenerMs: value + 1,
    startupCdpTargetMs: value + 2,
    startupDocumentMs: value + 3,
    startupInteractiveMs: value + 4,
  };
}

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
          ...startupPhaseTimings(calls),
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
      { scenario: "startup-cold-process", trials: [1, 2] },
      { scenario: "startup-cold-cdp-listener", trials: [2, 3] },
      { scenario: "startup-cold-cdp-target", trials: [3, 4] },
      { scenario: "startup-cold-document", trials: [4, 5] },
      { scenario: "startup-cold-interactive", trials: [5, 6] },
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
          ...startupPhaseTimings(),
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
          ...startupPhaseTimings(),
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
          ...startupPhaseTimings(),
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
      "startup-cold-process",
      "startup-cold-cdp-listener",
      "startup-cold-cdp-target",
      "startup-cold-document",
      "startup-cold-interactive",
      "ready-to-fixture-request-plain",
      "first-render-plain",
      "repeat-render-plain",
      "ready-to-fixture-request-rich",
      "first-render-rich",
      "repeat-render-rich",
    ]
  );
});

test("primes once and measures five launches in one reusable warm workspace", async () => {
  const workspace = { port: 41_238, runDir: "C:\\temp\\warm-owned" };
  const seenWorkspaces = [];
  const preflights = [];
  let cleanupCalls = 0;
  let leaseReleaseCalls = 0;
  const suite = await runWarmStartupSuite({
    trialCount: 5,
    allocatePort: async () => workspace.port,
    prepareLaunch: (options) => {
      preflights.push(options);
      return { prepared: true };
    },
    createWorkspace: () => workspace,
    assertWorkspaceIdentity: (actualWorkspace) => assert.equal(actualWorkspace, workspace),
    acquireWorkspaceLease: async (actualWorkspace) => {
      assert.equal(actualWorkspace, workspace);
      return {
        release: async () => {
          leaseReleaseCalls += 1;
        },
      };
    },
    measureStartup: async (actualWorkspace) => {
      seenWorkspaces.push(actualWorkspace);
      return {
        startupMs: 100 + seenWorkspaces.length,
        ...startupPhaseTimings(seenWorkspaces.length),
      };
    },
    cleanupWorkspace: (actualWorkspace) => {
      assert.equal(actualWorkspace, workspace);
      cleanupCalls += 1;
    },
  });
  assert.equal(suite.primed, true);
  assert.equal(seenWorkspaces.length, 6);
  assert.ok(seenWorkspaces.every((value) => value === workspace));
  assert.equal(preflights.length, 7);
  assert.equal(cleanupCalls, 1);
  assert.equal(leaseReleaseCalls, 1);
  assert.deepEqual(suite.timings[0].trials, [102, 103, 104, 105, 106]);
  assert.deepEqual(
    suite.timings.map((timing) => timing.scenario),
    [
      "startup-warm",
      "startup-warm-process",
      "startup-warm-cdp-listener",
      "startup-warm-cdp-target",
      "startup-warm-document",
      "startup-warm-interactive",
    ]
  );
});

test("does not report warm timing when priming fails", async () => {
  let cleanupCalls = 0;
  const suite = await runWarmStartupSuite({
    trialCount: 2,
    allocatePort: async () => 41_239,
    prepareLaunch: () => ({ prepared: true }),
    createWorkspace: () => ({ port: 41_239, runDir: "C:\\temp\\warm-owned" }),
    assertWorkspaceIdentity: () => {},
    acquireWorkspaceLease: async () => ({ release: async () => {} }),
    measureStartup: async () => {
      throw new Error("injected priming failure");
    },
    cleanupWorkspace: () => {
      cleanupCalls += 1;
    },
  });
  assert.equal(cleanupCalls, 1);
  assert.equal(suite.primed, false);
  assert.equal(suite.trials.length, 0);
  assert.equal(suite.timings[0].status, "failed");
});

test("does not launch warm priming when already interrupted", async () => {
  const controller = new AbortController();
  controller.abort();
  let startupCalls = 0;
  const suite = await runWarmStartupSuite({
    trialCount: 2,
    signal: controller.signal,
    measureStartup: async () => {
      startupCalls += 1;
    },
  });
  assert.equal(startupCalls, 0);
  assert.equal(suite.interrupted, true);
  assert.equal(suite.primed, false);
});

test("releases the directory lease but preserves workspace after unsafe shutdown", async () => {
  const workspace = { port: 41_240, runDir: "C:\\temp\\warm-owned" };
  let startupCalls = 0;
  let leaseReleaseCalls = 0;
  let cleanupCalls = 0;
  const suite = await runWarmStartupSuite({
    trialCount: 2,
    allocatePort: async () => workspace.port,
    prepareLaunch: () => ({ prepared: true }),
    createWorkspace: () => workspace,
    assertWorkspaceIdentity: () => {},
    acquireWorkspaceLease: async () => ({
      release: async () => {
        leaseReleaseCalls += 1;
      },
    }),
    measureStartup: async () => {
      startupCalls += 1;
      if (startupCalls === 1) return { startupMs: 100 };
      const error = new Error("injected unsafe shutdown");
      error.performanceTrialContinuationSafe = false;
      error.performanceWorkspaceCleanupSafe = false;
      throw error;
    },
    cleanupWorkspace: () => {
      cleanupCalls += 1;
    },
  });
  assert.equal(startupCalls, 2);
  assert.equal(leaseReleaseCalls, 1);
  assert.equal(cleanupCalls, 0);
  assert.equal(suite.continuationSafe, false);
});

test("preserves workspace when lease acquisition termination is unconfirmed", async () => {
  const workspace = { port: 41_241, runDir: "C:\\temp\\warm-owned" };
  let startupCalls = 0;
  let cleanupCalls = 0;
  const suite = await runWarmStartupSuite({
    trialCount: 2,
    allocatePort: async () => workspace.port,
    prepareLaunch: () => ({ prepared: true }),
    createWorkspace: () => workspace,
    assertWorkspaceIdentity: () => {},
    acquireWorkspaceLease: async () => {
      const error = new Error("injected unconfirmed lease termination");
      error.performanceWorkspaceCleanupSafe = false;
      throw error;
    },
    measureStartup: async () => {
      startupCalls += 1;
    },
    cleanupWorkspace: () => {
      cleanupCalls += 1;
    },
  });
  assert.equal(startupCalls, 0);
  assert.equal(cleanupCalls, 0);
  assert.equal(suite.continuationSafe, false);
  assert.equal(suite.setupFailure, "Error");
});

test("cleans workspace when trial continuation is unsafe but cleanup is safe", async () => {
  const workspace = { port: 41_242, runDir: "C:\\temp\\warm-owned" };
  let startupCalls = 0;
  let cleanupCalls = 0;
  const suite = await runWarmStartupSuite({
    trialCount: 2,
    allocatePort: async () => workspace.port,
    prepareLaunch: () => ({ prepared: true }),
    createWorkspace: () => workspace,
    assertWorkspaceIdentity: () => {},
    acquireWorkspaceLease: async () => ({ release: async () => {} }),
    measureStartup: async () => {
      startupCalls += 1;
      if (startupCalls === 1) return { startupMs: 100 };
      const error = new Error("injected confirmed shutdown failure");
      error.performanceTrialContinuationSafe = false;
      error.performanceWorkspaceCleanupSafe = true;
      throw error;
    },
    cleanupWorkspace: () => {
      cleanupCalls += 1;
    },
  });
  assert.equal(startupCalls, 2);
  assert.equal(cleanupCalls, 1);
  assert.equal(suite.continuationSafe, false);
});
