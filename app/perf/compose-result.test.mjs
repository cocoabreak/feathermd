import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { composePerformanceResult, parseDistributionArguments } from "./compose-result.mjs";

const size = { fileCount: 1, rawBytes: 100, brotliBytes: 50 };

function buildResult() {
  return {
    schemaVersion: 3,
    fixtureVersion: "plain-v1+rich-v1",
    measuredAt: "2026-08-09T00:00:00.000Z",
    source: { commit: "abc123", appVersion: "0.2.4", dirty: false },
    environment: {
      id: "win32-x64-frontend-size",
      os: "win32 10.0.0",
      architecture: "x64",
      node: "v24.0.0",
      measurement: "build-size",
    },
    build: {
      type: "production-frontend",
      total: size,
      initial: size,
      lazy: size,
      byType: Object.fromEntries(
        ["javascript", "css", "image", "font", "other"].map((kind) => [kind, size])
      ),
      featureGroups: Object.fromEntries(["katex", "mermaid", "shiki"].map((kind) => [kind, size])),
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

function timingEntry(scenario) {
  return {
    scenario,
    status: "measured",
    trials: [10, 11, 12],
    medianMs: 11,
    minMs: 10,
    maxMs: 12,
  };
}

const timingResult = {
  interrupted: false,
  continuationSafe: true,
  timings: [
    "startup-cold",
    "ready-to-fixture-request-plain",
    "first-render-plain",
    "repeat-render-plain",
    "ready-to-fixture-request-rich",
    "first-render-rich",
    "repeat-render-rich",
    "startup-warm",
  ].map(timingEntry),
};

function memoryEntry(scenario, pid) {
  return {
    scenario,
    status: "measured",
    processCount: 1,
    workingSetBytes: 20,
    privateMemoryBytes: 10,
    processes: [
      {
        pid,
        parentPid: 0,
        name: "feathermd.exe",
        workingSet64: 20,
        privateMemorySize64: 10,
      },
    ],
  };
}

const memoryResult = {
  interrupted: false,
  continuationSafe: true,
  memory: [memoryEntry("empty", 1), memoryEntry("plain", 2), memoryEntry("rich", 3)],
};

const environment = {
  id: "windows-reference",
  os: "Windows 11",
  architecture: "x64",
  node: "v24.0.0",
  measurement: "release-qa",
};

test("composePerformanceResult combines complete measurements without exposing paths", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "feathermd-compose-"));
  const executable = path.join(directory, "feathermd.exe");
  writeFileSync(executable, "binary");
  const result = composePerformanceResult({
    buildResult: buildResult(),
    timingResult,
    memoryResult,
    environment,
    buildType: "windows-x64-release-qa",
    distributionPaths: { executable },
  });
  assert.deepEqual(result.environment, environment);
  assert.equal(result.build.type, "windows-x64-release-qa");
  assert.deepEqual(result.build.distributions.executable, { status: "measured", rawBytes: 6 });
  assert.equal(result.build.distributions.msi.status, "not-measured");
  assert.deepEqual(result.timings, timingResult.timings);
  assert.deepEqual(result.memory, memoryResult.memory);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(directory.replaceAll("\\", "\\\\")));
});

test("composePerformanceResult rejects dirty or incomplete inputs", () => {
  const dirty = buildResult();
  dirty.source.dirty = true;
  assert.throws(
    () =>
      composePerformanceResult({
        buildResult: dirty,
        timingResult,
        memoryResult,
        environment,
        buildType: "windows-x64-release-qa",
      }),
    /clean worktree/
  );
  assert.throws(
    () =>
      composePerformanceResult({
        buildResult: buildResult(),
        timingResult: { ...timingResult, interrupted: true },
        memoryResult,
        environment,
        buildType: "windows-x64-release-qa",
      }),
    /interrupted/
  );
  assert.throws(
    () =>
      composePerformanceResult({
        buildResult: buildResult(),
        timingResult: { ...timingResult, timings: timingResult.timings.slice(1) },
        memoryResult,
        environment,
        buildType: "windows-x64-release-qa",
      }),
    /expected scenarios/
  );
  assert.throws(
    () =>
      composePerformanceResult({
        buildResult: buildResult(),
        timingResult,
        memoryResult,
        environment,
        buildType: "windows-x64-release-qa",
        distributionPaths: { executable: path.join(os.tmpdir(), "missing-feathermd.exe") },
      }),
    /specified distribution was not measured/
  );
});

test("parseDistributionArguments accepts known unique kinds only", () => {
  const parsed = parseDistributionArguments(["executable=release/feathermd.exe"]);
  assert.equal(parsed.executable, path.resolve("release/feathermd.exe"));
  assert.throws(() => parseDistributionArguments(["deb=release/app.deb"]), /invalid/);
  assert.throws(() => parseDistributionArguments(["msi=first.msi", "msi=second.msi"]), /duplicate/);
});
