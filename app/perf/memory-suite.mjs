import path from "node:path";
import { fileURLToPath } from "node:url";
import { measurePerformanceMemoryScenario } from "./measure.mjs";

export const MEMORY_SCENARIOS = ["empty", "plain", "rich"];

function failureCode(error) {
  if (typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)) return error.code;
  return "PerformanceMemoryScenarioError";
}

export async function runMemoryMeasurementSuite({
  measureScenario = measurePerformanceMemoryScenario,
  scenarios = MEMORY_SCENARIOS,
  signal,
} = {}) {
  const memory = [];
  let continuationSafe = true;
  for (const scenario of scenarios) {
    if (signal?.aborted) break;
    try {
      memory.push(await measureScenario({ scenario }));
    } catch (error) {
      memory.push({ scenario, status: "failed", error: failureCode(error) });
      continuationSafe = error?.performanceTrialContinuationSafe !== false;
      if (!continuationSafe) break;
    }
  }
  return { interrupted: signal?.aborted === true, continuationSafe, memory };
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
    const result = await runMemoryMeasurementSuite({ signal: controller.signal });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.interrupted) process.exitCode = signalExitCode || 1;
    else if (
      !result.continuationSafe ||
      result.memory.length !== MEMORY_SCENARIOS.length ||
      result.memory.some((entry) => entry.status !== "measured")
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
