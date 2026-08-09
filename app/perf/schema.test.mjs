import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_VERSION,
  PERFORMANCE_SCHEMA_VERSION,
  assertPublicResultSafe,
  validatePerformanceResult,
} from "./schema.mjs";

function validResult() {
  const size = { fileCount: 1, rawBytes: 10, brotliBytes: 8 };
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    fixtureVersion: FIXTURE_VERSION,
    measuredAt: "2026-08-01T00:00:00.000Z",
    source: { commit: "abc123", appVersion: "1.0.0", dirty: false },
    environment: {
      id: "windows-x64-test",
      os: "win32 test",
      architecture: "x64",
      node: "v24.0.0",
      measurement: "build-size",
    },
    build: {
      type: "production-frontend",
      total: size,
      initial: size,
      lazy: { fileCount: 0, rawBytes: 0, brotliBytes: 0 },
      byType: Object.fromEntries(
        ["javascript", "css", "image", "font", "other"].map((type) => [type, size])
      ),
      featureGroups: Object.fromEntries(
        ["katex", "mermaid", "shiki"].map((feature) => [feature, size])
      ),
      distributions: Object.fromEntries(
        ["executable", "msi", "nsis", "portableZip"].map((kind) => [
          kind,
          { status: "not-measured" },
        ])
      ),
      largestFiles: [],
    },
    timings: [],
    memory: [],
  };
}

test("validates a build-only performance result", () => {
  assert.equal(validatePerformanceResult(validResult()).schemaVersion, PERFORMANCE_SCHEMA_VERSION);
});

test("rejects unsupported schemas and partial sizes", () => {
  const unsupported = validResult();
  unsupported.schemaVersion = 99;
  assert.throws(() => validatePerformanceResult(unsupported), /unsupported schemaVersion/);
  const partial = validResult();
  delete partial.build.total.brotliBytes;
  assert.throws(() => validatePerformanceResult(partial), /brotliBytes/);
  const missingEnvironmentId = validResult();
  delete missingEnvironmentId.environment.id;
  assert.throws(() => validatePerformanceResult(missingEnvironmentId), /environment.id/);
  const missingBuildType = validResult();
  delete missingBuildType.build.type;
  assert.throws(() => validatePerformanceResult(missingBuildType), /build.type/);
});

test("rejects local paths and runtime identifiers", () => {
  const withPath = validResult();
  withPath.environment.note = "C:\\Users\\alice\\notes";
  assert.throws(() => assertPublicResultSafe(withPath, []), /absolute local path/);
  const withUncPath = validResult();
  withUncPath.environment.note = "\\\\server\\share\\notes";
  assert.throws(() => assertPublicResultSafe(withUncPath, []), /absolute local path/);
  for (const localPath of ["/opt/project/file.md", "/workspace/project/file.md"]) {
    const withPosixPath = validResult();
    withPosixPath.environment.note = localPath;
    assert.throws(() => assertPublicResultSafe(withPosixPath, []), /absolute local path/);
  }
  const withUser = validResult();
  withUser.environment.note = "builder-alice";
  assert.throws(() => assertPublicResultSafe(withUser, ["builder-alice"]), /local environment/);
});

test("validates measured timing and memory entries", () => {
  const result = validResult();
  result.timings.push({
    scenario: "startup-cold",
    status: "measured",
    trials: [10, 11, 12],
    medianMs: 11,
    minMs: 10,
    maxMs: 12,
  });
  result.memory.push({
    scenario: "plain",
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
  });
  assert.doesNotThrow(() => validatePerformanceResult(result));
  delete result.timings[0].medianMs;
  assert.throws(() => validatePerformanceResult(result), /medianMs/);
});

test("rejects partial or inconsistent memory snapshots", () => {
  const result = validResult();
  result.memory.push({ scenario: "empty", status: "not-measured", reason: "process-missing" });
  assert.doesNotThrow(() => validatePerformanceResult(result));
  delete result.memory[0].reason;
  assert.throws(() => validatePerformanceResult(result), /reason/);

  result.memory[0] = {
    scenario: "plain",
    status: "measured",
    processCount: 1,
    workingSetBytes: 101,
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
  assert.throws(() => validatePerformanceResult(result), /workingSetBytes total/);
});

test("rejects duplicate timing and memory scenarios", () => {
  const timingResult = validResult();
  timingResult.timings = [
    { scenario: "startup", status: "failed", error: "failed" },
    { scenario: "startup", status: "not-measured", reason: "missing" },
  ];
  assert.throws(() => validatePerformanceResult(timingResult), /duplicate scenario/);

  const memoryResult = validResult();
  memoryResult.memory = [
    { scenario: "plain", status: "failed", error: "failed" },
    { scenario: "plain", status: "not-measured", reason: "missing" },
  ];
  assert.throws(() => validatePerformanceResult(memoryResult), /duplicate scenario/);
});

test("accepts sanitized public results", () => {
  assert.equal(assertPublicResultSafe(validResult(), []).source.commit, "abc123");
});
