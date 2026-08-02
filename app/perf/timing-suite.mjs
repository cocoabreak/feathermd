import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { findFreePort } from "../scripts/webview2-driver.mjs";
import { measurePerformanceWorkspaceStartup, verifyPerformanceLaunch } from "./measure.mjs";
import { preparePerformanceLaunch } from "./runner.mjs";
import {
  assertPerformanceWorkspaceIdentity,
  cleanupPerformanceWorkspace,
  createPerformanceWorkspace,
} from "./run-workspace.mjs";
import { acquirePerformanceWorkspaceLease } from "./windows-job.mjs";

export const DEFAULT_TIMING_TRIALS = 5;

const FIXTURE_SCENARIOS = {
  "plain-v1": [
    ["ready-to-fixture-request-plain", "readyToFixtureRequestMs"],
    ["first-render-plain", "firstRenderMs"],
    ["repeat-render-plain", "repeatRenderMs"],
  ],
  "rich-v1": [
    ["ready-to-fixture-request-rich", "readyToFixtureRequestMs"],
    ["first-render-rich", "firstRenderMs"],
    ["repeat-render-rich", "repeatRenderMs"],
  ],
};

function assertTrialCount(value) {
  assert.ok(Number.isInteger(value) && value > 0, "timing trial count must be positive");
}

function assertTimingValue(value, label) {
  assert.ok(Number.isFinite(value) && value >= 0, `${label} must be a non-negative number`);
}

export function summarizeTimingTrials(scenario, trials, { expectedTrials } = {}) {
  assert.ok(typeof scenario === "string" && scenario.length > 0, "timing scenario is required");
  assertTrialCount(expectedTrials);
  assert.equal(trials.length, expectedTrials, `${scenario} requires ${expectedTrials} trials`);
  trials.forEach((value, index) => assertTimingValue(value, `${scenario}[${index}]`));
  const sorted = [...trials].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    scenario,
    status: "measured",
    trials: [...trials],
    medianMs: Number(medianMs.toFixed(3)),
    minMs: sorted[0],
    maxMs: sorted.at(-1),
  };
}

function scenarioMappings(fixtureId, includeColdStartup) {
  const scenarios = FIXTURE_SCENARIOS[fixtureId];
  assert.ok(scenarios, `unsupported timing fixture: ${fixtureId}`);
  return includeColdStartup ? [["startup-cold", "startupColdMs"], ...scenarios] : scenarios;
}

function assertTrialResult(result, fixtureId, trialNumber) {
  assert.equal(result?.fixtureId, fixtureId, `trial ${trialNumber} returned the wrong fixture`);
  assert.equal(result.fixtureRendered, true, `trial ${trialNumber} did not render the fixture`);
  assert.equal(
    result.repeatFixtureRendered,
    true,
    `trial ${trialNumber} did not render the repeat fixture`
  );
  assert.ok(
    result.timings && typeof result.timings === "object",
    `trial ${trialNumber} has no timings`
  );
}

function failureReason(error) {
  if (typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)) return error.code;
  const message = typeof error?.message === "string" ? error.message : "";
  if (message.includes("performance AppData already exists")) return "PERFORMANCE_APPDATA_EXISTS";
  if (message.includes("FeatherMD is already running")) return "BACKGROUND_FEATHERMD_RUNNING";
  if (message.includes("timed out")) return "PERFORMANCE_TRIAL_TIMEOUT";
  if (typeof error?.name === "string" && /^[A-Za-z]+$/.test(error.name)) return error.name;
  return "PerformanceTrialError";
}

function failedTimings(mappings, successfulTrials, trialCount) {
  return mappings.map(([scenario]) => ({
    scenario,
    status: "failed",
    error: `${successfulTrials}/${trialCount} trials succeeded`,
  }));
}

export async function runFixtureTimingSuite({
  fixtureId,
  trialCount = DEFAULT_TIMING_TRIALS,
  includeColdStartup = false,
  measureTrial = verifyPerformanceLaunch,
  signal,
} = {}) {
  assertTrialCount(trialCount);
  const mappings = scenarioMappings(fixtureId, includeColdStartup);
  const results = [];
  const trials = [];
  let continuationSafe = true;
  for (let index = 0; index < trialCount && !signal?.aborted; index += 1) {
    try {
      const result = await measureTrial({ fixtureId });
      assertTrialResult(result, fixtureId, index + 1);
      results.push(result);
      trials.push({ trial: index + 1, status: "measured" });
    } catch (error) {
      continuationSafe = error?.performanceTrialContinuationSafe !== false;
      trials.push({ trial: index + 1, status: "failed", reason: failureReason(error) });
      if (!continuationSafe) break;
    }
  }

  const complete = results.length === trialCount && trials.length === trialCount;
  return {
    fixtureId,
    expectedTrials: trialCount,
    trials,
    interrupted: signal?.aborted === true,
    continuationSafe,
    timings: complete
      ? mappings.map(([scenario, field]) =>
          summarizeTimingTrials(
            scenario,
            results.map((result) => result.timings[field]),
            { expectedTrials: trialCount }
          )
        )
      : failedTimings(mappings, results.length, trialCount),
  };
}

export async function runColdTimingSuites(options = {}) {
  const trialCount = options.trialCount ?? DEFAULT_TIMING_TRIALS;
  const measureTrial = options.measureTrial ?? verifyPerformanceLaunch;
  const plain = await runFixtureTimingSuite({
    fixtureId: "plain-v1",
    trialCount,
    includeColdStartup: true,
    measureTrial,
    signal: options.signal,
  });
  const suites = [plain];
  if (!plain.interrupted && plain.continuationSafe) {
    suites.push(
      await runFixtureTimingSuite({
        fixtureId: "rich-v1",
        trialCount,
        measureTrial,
        signal: options.signal,
      })
    );
  }
  return {
    trialCount,
    interrupted: suites.some((suite) => suite.interrupted),
    continuationSafe: suites.every((suite) => suite.continuationSafe),
    suites,
    timings: suites.flatMap((suite) => suite.timings),
  };
}

export async function runWarmStartupSuite({
  trialCount = DEFAULT_TIMING_TRIALS,
  measureStartup = measurePerformanceWorkspaceStartup,
  allocatePort = findFreePort,
  prepareLaunch = preparePerformanceLaunch,
  createWorkspace = createPerformanceWorkspace,
  cleanupWorkspace = cleanupPerformanceWorkspace,
  assertWorkspaceIdentity = assertPerformanceWorkspaceIdentity,
  acquireWorkspaceLease = acquirePerformanceWorkspaceLease,
  signal,
} = {}) {
  assertTrialCount(trialCount);
  const trials = [];
  const values = [];
  let workspace;
  let workspaceLease;
  let primed = false;
  let continuationSafe = true;
  let workspaceCleanupSafe = true;
  let setupFailure;
  if (signal?.aborted) {
    return {
      primed: false,
      expectedTrials: trialCount,
      trials,
      interrupted: true,
      continuationSafe: true,
      timings: [
        { scenario: "startup-warm", status: "failed", error: `0/${trialCount} trials succeeded` },
      ],
    };
  }
  try {
    const port = await allocatePort();
    if (signal?.aborted) throw new Error("performance warm suite was interrupted");
    const plan = prepareLaunch({
      port,
      runDir: path.win32.join(os.tmpdir(), "feathermd-performance-warm-planned"),
    });
    workspace = createWorkspace(plan);
    assertWorkspaceIdentity(workspace);
    workspaceLease = await acquireWorkspaceLease(workspace);
    assertWorkspaceIdentity(workspace);
    if (signal?.aborted) throw new Error("performance warm suite was interrupted");
    prepareLaunch({ port: workspace.port, runDir: workspace.runDir });
    await measureStartup(workspace);
    primed = true;

    for (let index = 0; index < trialCount && !signal?.aborted; index += 1) {
      try {
        prepareLaunch({ port: workspace.port, runDir: workspace.runDir });
        const result = await measureStartup(workspace);
        assertTimingValue(result?.startupMs, `startup-warm[${index}]`);
        values.push(result.startupMs);
        trials.push({ trial: index + 1, status: "measured" });
      } catch (error) {
        workspaceCleanupSafe = error?.performanceWorkspaceCleanupSafe !== false;
        continuationSafe =
          workspaceCleanupSafe && error?.performanceTrialContinuationSafe !== false;
        trials.push({ trial: index + 1, status: "failed", reason: failureReason(error) });
        if (!continuationSafe) break;
      }
    }
  } catch (error) {
    workspaceCleanupSafe = error?.performanceWorkspaceCleanupSafe !== false;
    continuationSafe = workspaceCleanupSafe && error?.performanceTrialContinuationSafe !== false;
    setupFailure = failureReason(error);
  } finally {
    if (workspaceLease) {
      try {
        await workspaceLease.release();
      } catch (error) {
        continuationSafe = false;
        workspaceCleanupSafe = false;
        setupFailure ??= failureReason(error);
      }
    }
    if (workspace && workspaceCleanupSafe) {
      try {
        cleanupWorkspace(workspace);
      } catch (error) {
        continuationSafe = false;
        setupFailure ??= failureReason(error);
      }
    }
  }

  const complete =
    primed &&
    values.length === trialCount &&
    trials.length === trialCount &&
    !signal?.aborted &&
    continuationSafe;
  return {
    primed,
    expectedTrials: trialCount,
    trials,
    interrupted: signal?.aborted === true,
    continuationSafe,
    ...(setupFailure ? { setupFailure } : {}),
    timings: [
      complete
        ? summarizeTimingTrials("startup-warm", values, { expectedTrials: trialCount })
        : {
            scenario: "startup-warm",
            status: "failed",
            error: `${values.length}/${trialCount} trials succeeded`,
          },
    ],
  };
}

export async function runTimingSuites(options = {}) {
  const cold = await runColdTimingSuites(options);
  const suites = [...cold.suites];
  if (!cold.interrupted && cold.continuationSafe) {
    suites.push(await runWarmStartupSuite(options));
  }
  return {
    trialCount: cold.trialCount,
    interrupted: suites.some((suite) => suite.interrupted),
    continuationSafe: suites.every((suite) => suite.continuationSafe),
    suites,
    timings: suites.flatMap((suite) => suite.timings),
  };
}

async function runCli() {
  const controller = new AbortController();
  let signalExitCode = 0;
  const onInterrupt = () => {
    signalExitCode = 130;
    controller.abort();
  };
  const onTerminate = () => {
    signalExitCode = 143;
    controller.abort();
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    const result = await runTimingSuites({ signal: controller.signal });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.interrupted) process.exitCode = signalExitCode || 1;
    else if (
      !result.continuationSafe ||
      result.suites.some(
        (suite) =>
          suite.trials.length < result.trialCount ||
          suite.timings.some((timing) => timing.status !== "measured")
      )
    ) {
      process.exitCode = 1;
    }
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
