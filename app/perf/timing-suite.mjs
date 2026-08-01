import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyPerformanceLaunch } from "./measure.mjs";

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
    const result = await runColdTimingSuites({ signal: controller.signal });
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
