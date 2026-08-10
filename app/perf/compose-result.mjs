import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectDistributionMetrics } from "./build-metrics.mjs";
import { assertPublicResultSafe, validatePerformanceResult } from "./schema.mjs";
import { writePerformanceArtifacts } from "./report.mjs";

const DISTRIBUTION_KINDS = new Set(["executable", "msi", "nsis", "portableZip"]);
const TIMING_SCENARIOS = [
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
  "startup-warm",
  "startup-warm-process",
  "startup-warm-cdp-listener",
  "startup-warm-cdp-target",
  "startup-warm-document",
  "startup-warm-interactive",
];
const MEMORY_SCENARIOS = ["empty", "plain", "rich"];

function assertCompleteSuite(result, entriesKey, expectedScenarios, label) {
  if (!result || typeof result !== "object") throw new Error(`${label} must be an object`);
  if (result.interrupted === true) throw new Error(`${label} was interrupted`);
  if (result.continuationSafe !== true) throw new Error(`${label} did not finish safely`);
  if (!Array.isArray(result[entriesKey]) || result[entriesKey].length === 0) {
    throw new Error(`${label}.${entriesKey} must contain measured entries`);
  }
  if (result[entriesKey].some((entry) => entry?.status !== "measured")) {
    throw new Error(`${label}.${entriesKey} contains an incomplete measurement`);
  }
  const actualScenarios = new Set(result[entriesKey].map((entry) => entry.scenario));
  if (
    actualScenarios.size !== expectedScenarios.length ||
    expectedScenarios.some((scenario) => !actualScenarios.has(scenario))
  ) {
    throw new Error(`${label}.${entriesKey} does not contain the expected scenarios`);
  }
}

export function composePerformanceResult({
  buildResult,
  timingResult,
  memoryResult,
  environment,
  buildType,
  distributionPaths = {},
}) {
  validatePerformanceResult(buildResult);
  assertPublicResultSafe(buildResult);
  if (buildResult.source.dirty) throw new Error("a baseline result requires a clean worktree");
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new Error("environment must be an object");
  }
  if (typeof buildType !== "string" || buildType.length === 0) {
    throw new Error("buildType must be a non-empty string");
  }
  assertCompleteSuite(timingResult, "timings", TIMING_SCENARIOS, "timing result");
  assertCompleteSuite(memoryResult, "memory", MEMORY_SCENARIOS, "memory result");

  const result = structuredClone(buildResult);
  result.environment = structuredClone(environment);
  result.build.type = buildType;
  result.build.distributions = collectDistributionMetrics(distributionPaths);
  for (const kind of Object.keys(distributionPaths)) {
    if (result.build.distributions[kind].status !== "measured") {
      throw new Error(`specified distribution was not measured: ${kind}`);
    }
  }
  result.timings = structuredClone(timingResult.timings);
  result.memory = structuredClone(memoryResult.memory);
  validatePerformanceResult(result);
  assertPublicResultSafe(result);
  return result;
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new Error(`${label} JSON could not be read`, { cause: error });
  }
}

export function parseDistributionArguments(values) {
  const paths = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    const kind = separator > 0 ? value.slice(0, separator) : "";
    const file = separator > 0 ? value.slice(separator + 1) : "";
    if (!DISTRIBUTION_KINDS.has(kind) || file.length === 0) {
      throw new Error(`invalid distribution argument: ${value}`);
    }
    if (paths[kind]) throw new Error(`duplicate distribution argument: ${kind}`);
    paths[kind] = path.resolve(file);
  }
  return paths;
}

function runCli() {
  const [buildFile, timingFile, memoryFile, environmentFile, outputDirectory, ...distributions] =
    process.argv.slice(2);
  if (!buildFile || !timingFile || !memoryFile || !environmentFile || !outputDirectory) {
    throw new Error(
      "usage: compose-result.mjs <build-result.json> <timings.json> <memory.json> " +
        "<environment.json> <output-directory> [kind=path ...]"
    );
  }
  const metadata = readJson(environmentFile, "environment");
  const result = composePerformanceResult({
    buildResult: readJson(buildFile, "build result"),
    timingResult: readJson(timingFile, "timing result"),
    memoryResult: readJson(memoryFile, "memory result"),
    environment: metadata.environment,
    buildType: metadata.buildType,
    distributionPaths: parseDistributionArguments(distributions),
  });
  const output = path.resolve(outputDirectory);
  writePerformanceArtifacts({ result, artifactsDir: output });
  process.stdout.write(`${path.join(output, "result.json")}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
