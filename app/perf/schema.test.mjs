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
      os: "win32 test",
      architecture: "x64",
      node: "v24.0.0",
      measurement: "build-size",
    },
    build: {
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
    processCount: 4,
    workingSetBytes: 100,
    privateMemoryBytes: 80,
  });
  assert.doesNotThrow(() => validatePerformanceResult(result));
  delete result.timings[0].medianMs;
  assert.throws(() => validatePerformanceResult(result), /medianMs/);
});

test("accepts sanitized public results", () => {
  assert.equal(assertPublicResultSafe(validResult(), []).source.commit, "abc123");
});
