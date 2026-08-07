import path from "node:path";

export const PERFORMANCE_SCHEMA_VERSION = 2;
export const FIXTURE_VERSION = "plain-v1+rich-v1";

const ABSOLUTE_PATH = /(?:^|[\s("'=])(?:[a-zA-Z]:[\\/]|\\\\|\/(?!\/))/;
const SIZE_TYPES = ["javascript", "css", "image", "font", "other"];
const FEATURE_GROUPS = ["katex", "mermaid", "shiki"];
const DISTRIBUTIONS = ["executable", "msi", "nsis", "portableZip"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertFiniteNonNegative(value, label) {
  assert(Number.isFinite(value) && value >= 0, `${label} must be a non-negative number`);
}

function assertNonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function assertString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
}

function assertSizeSummary(value, label) {
  assert(value && typeof value === "object", `${label} must be an object`);
  assertFiniteNonNegative(value.fileCount, `${label}.fileCount`);
  assertFiniteNonNegative(value.rawBytes, `${label}.rawBytes`);
  assertFiniteNonNegative(value.brotliBytes, `${label}.brotliBytes`);
}

function assertScenarioMetric(value, label, kind) {
  assert(value && typeof value === "object", `${label} must be an object`);
  assertString(value.scenario, `${label}.scenario`);
  assert(
    ["measured", "failed", "not-measured"].includes(value.status),
    `${label}.status is invalid`
  );
  if (value.status === "failed") assertString(value.error, `${label}.error`);
  if (value.status === "not-measured") assertString(value.reason, `${label}.reason`);
  if (value.status !== "measured") return;
  if (kind === "timing") {
    assert(Array.isArray(value.trials) && value.trials.length > 0, `${label}.trials is required`);
    value.trials.forEach((trial, index) =>
      assertFiniteNonNegative(trial, `${label}.trials[${index}]`)
    );
    assertFiniteNonNegative(value.medianMs, `${label}.medianMs`);
    assertFiniteNonNegative(value.minMs, `${label}.minMs`);
    assertFiniteNonNegative(value.maxMs, `${label}.maxMs`);
  } else {
    assertNonNegativeInteger(value.processCount, `${label}.processCount`);
    assertNonNegativeInteger(value.workingSetBytes, `${label}.workingSetBytes`);
    assertNonNegativeInteger(value.privateMemoryBytes, `${label}.privateMemoryBytes`);
    assert(
      Array.isArray(value.processes) && value.processes.length === value.processCount,
      `${label}.processes must match processCount`
    );
    const pids = new Set();
    let workingSetTotal = 0;
    let privateMemoryTotal = 0;
    value.processes.forEach((process, index) => {
      const processLabel = `${label}.processes[${index}]`;
      assertNonNegativeInteger(process?.pid, `${processLabel}.pid`);
      assert(process.pid > 0, `${processLabel}.pid must be positive`);
      assertNonNegativeInteger(process.parentPid, `${processLabel}.parentPid`);
      assertString(process.name, `${processLabel}.name`);
      assert(/^[a-zA-Z0-9._-]+$/.test(process.name), `${processLabel}.name is invalid`);
      assertNonNegativeInteger(process.workingSet64, `${processLabel}.workingSet64`);
      assertNonNegativeInteger(process.privateMemorySize64, `${processLabel}.privateMemorySize64`);
      assert(!pids.has(process.pid), `${label}.processes contains a duplicate PID`);
      pids.add(process.pid);
      workingSetTotal += process.workingSet64;
      privateMemoryTotal += process.privateMemorySize64;
    });
    assert(workingSetTotal === value.workingSetBytes, `${label}.workingSetBytes total is invalid`);
    assert(
      privateMemoryTotal === value.privateMemoryBytes,
      `${label}.privateMemoryBytes total is invalid`
    );
  }
}

export function validatePerformanceResult(result) {
  assert(result && typeof result === "object", "result must be an object");
  assert(
    result.schemaVersion === PERFORMANCE_SCHEMA_VERSION,
    `unsupported schemaVersion: ${result.schemaVersion}`
  );
  assert(result.fixtureVersion === FIXTURE_VERSION, "fixtureVersion does not match fixtures");
  assertString(result.measuredAt, "measuredAt");
  const measuredAt = Date.parse(result.measuredAt);
  assert(
    !Number.isNaN(measuredAt) && new Date(measuredAt).toISOString() === result.measuredAt,
    "measuredAt must be an ISO timestamp"
  );
  assert(result.source && typeof result.source === "object", "source must be an object");
  assertString(result.source.commit, "source.commit");
  assertString(result.source.appVersion, "source.appVersion");
  assert(typeof result.source.dirty === "boolean", "source.dirty must be boolean");
  assert(result.environment && typeof result.environment === "object", "environment is required");
  for (const key of ["os", "architecture", "node", "measurement"]) {
    assertString(result.environment[key], `environment.${key}`);
  }
  for (const [key, value] of Object.entries(result.environment)) {
    assertString(key, "environment key");
    assert(
      typeof value === "string" || typeof value === "number" || typeof value === "boolean",
      `environment.${key} must be a primitive`
    );
  }
  assert(result.build && typeof result.build === "object", "build is required");
  assertSizeSummary(result.build.total, "build.total");
  assertSizeSummary(result.build.initial, "build.initial");
  assertSizeSummary(result.build.lazy, "build.lazy");
  assert(Array.isArray(result.build.largestFiles), "build.largestFiles must be an array");
  assert(
    result.build.byType && typeof result.build.byType === "object",
    "build.byType is required"
  );
  assert(
    result.build.featureGroups && typeof result.build.featureGroups === "object",
    "build.featureGroups is required"
  );
  assert(
    result.build.distributions && typeof result.build.distributions === "object",
    "distributions required"
  );
  for (const key of SIZE_TYPES) assertSizeSummary(result.build.byType[key], `build.byType.${key}`);
  for (const key of FEATURE_GROUPS) {
    assertSizeSummary(result.build.featureGroups[key], `build.featureGroups.${key}`);
  }
  for (const key of DISTRIBUTIONS) {
    const distribution = result.build.distributions[key];
    assert(
      distribution?.status === "measured" || distribution?.status === "not-measured",
      `build.distributions.${key}.status is invalid`
    );
    if (distribution.status === "measured") {
      assertFiniteNonNegative(distribution.rawBytes, `build.distributions.${key}.rawBytes`);
    }
  }
  result.build.largestFiles.forEach((file, index) => {
    assertString(file?.file, `build.largestFiles[${index}].file`);
    assert(SIZE_TYPES.includes(file?.type), `build.largestFiles[${index}].type is invalid`);
    assertFiniteNonNegative(file?.rawBytes, `build.largestFiles[${index}].rawBytes`);
    assertFiniteNonNegative(file?.brotliBytes, `build.largestFiles[${index}].brotliBytes`);
  });
  assert(Array.isArray(result.timings), "timings must be an array");
  assert(Array.isArray(result.memory), "memory must be an array");
  result.timings.forEach((value, index) =>
    assertScenarioMetric(value, `timings[${index}]`, "timing")
  );
  result.memory.forEach((value, index) =>
    assertScenarioMetric(value, `memory[${index}]`, "memory")
  );
  return result;
}

export function sensitiveRuntimeValues({ cwd = process.cwd(), env = process.env } = {}) {
  const candidates = [cwd, env.USERPROFILE, env.HOME, env.USERNAME, env.USER, env.COMPUTERNAME];
  return [...new Set(candidates.filter((value) => typeof value === "string" && value.length >= 3))];
}

export function assertPublicResultSafe(result, sensitiveValues = sensitiveRuntimeValues()) {
  const strings = [];
  function collectStrings(value) {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(collectStrings);
    else if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => {
        strings.push(key);
        collectStrings(child);
      });
    }
  }
  collectStrings(result);
  if (strings.some((value) => ABSOLUTE_PATH.test(value))) {
    throw new Error("performance result contains an absolute local path");
  }
  for (const value of sensitiveValues) {
    const variants = [value, value.replaceAll("\\", "/"), path.normalize(value)];
    if (variants.some((variant) => variant && strings.some((text) => text.includes(variant)))) {
      throw new Error("performance result contains local environment information");
    }
  }
  return result;
}
