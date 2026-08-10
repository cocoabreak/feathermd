import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  comparePerformanceResults,
  performanceMarkdown,
  writePerformanceArtifacts,
} from "./report.mjs";
import { FIXTURE_VERSION, PERFORMANCE_SCHEMA_VERSION } from "./schema.mjs";

const reportScript = fileURLToPath(new URL("./report.mjs", import.meta.url));

function size(rawBytes = 100, brotliBytes = 50) {
  return { fileCount: 1, rawBytes, brotliBytes };
}

function result() {
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    fixtureVersion: FIXTURE_VERSION,
    measuredAt: "2026-08-09T00:00:00.000Z",
    source: { commit: "abc123", appVersion: "1.0.0", dirty: false },
    environment: {
      id: "windows-x64-reference",
      os: "win32 test",
      architecture: "x64",
      node: "v24.0.0",
      measurement: "release",
    },
    build: {
      type: "tauri-release",
      total: size(200, 100),
      initial: size(120, 60),
      lazy: size(80, 40),
      byType: Object.fromEntries(
        ["javascript", "css", "image", "font", "other"].map((type) => [type, size()])
      ),
      featureGroups: Object.fromEntries(
        ["katex", "mermaid", "shiki"].map((feature) => [feature, size()])
      ),
      distributions: Object.fromEntries(
        ["executable", "msi", "nsis", "portableZip"].map((kind) => [
          kind,
          { status: "not-measured" },
        ])
      ),
      largestFiles: [],
    },
    timings: [
      {
        scenario: "startup-cold",
        status: "measured",
        trials: [10, 12, 14],
        medianMs: 12,
        minMs: 10,
        maxMs: 14,
      },
    ],
    memory: [
      {
        scenario: "plain",
        status: "measured",
        processCount: 1,
        workingSetBytes: 1000,
        privateMemoryBytes: 800,
        processes: [
          {
            pid: 100,
            parentPid: 1,
            name: "feathermd.exe",
            workingSet64: 1000,
            privateMemorySize64: 800,
          },
        ],
      },
    ],
  };
}

test("labels CI threshold reports only when explicitly requested", () => {
  const reportOnly = performanceMarkdown(result());
  const enforced = performanceMarkdown(result(), undefined, { reportMode: "ci-threshold" });
  assert.match(reportOnly, /Mode: report only/);
  assert.match(enforced, /Mode: CI size threshold enforced/);
  assert.throws(
    () => performanceMarkdown(result(), undefined, { reportMode: "unknown" }),
    /unsupported performance report mode/
  );
});

test("compares size, timing, and memory values with deltas", () => {
  const baseline = result();
  const current = structuredClone(baseline);
  current.build.total.rawBytes = 250;
  current.timings[0].medianMs = 15;
  current.memory[0].workingSetBytes = 1200;
  current.memory[0].processes[0].workingSet64 = 1200;

  const comparison = comparePerformanceResults(current, baseline);
  assert.equal(comparison.status, "comparable");
  const totalRaw = comparison.metrics.sizes.find((entry) => entry.id === "build.total.raw");
  assert.deepEqual(
    { current: totalRaw.current, baseline: totalRaw.baseline, delta: totalRaw.delta },
    { current: 250, baseline: 200, delta: 50 }
  );
  assert.equal(totalRaw.deltaPercent, 25);
  assert.equal(comparison.metrics.timings[0].delta, 3);
  assert.equal(comparison.metrics.memory[0].delta, 200);
});

test("refuses incompatible baseline identities without calculating deltas", () => {
  for (const mutate of [
    (baseline) => (baseline.schemaVersion = PERFORMANCE_SCHEMA_VERSION - 1),
    (baseline) => (baseline.fixtureVersion = "plain-v0"),
    (baseline) => (baseline.environment.id = "another-machine"),
    (baseline) => (baseline.build.type = "debug"),
  ]) {
    const baseline = result();
    mutate(baseline);
    const comparison = comparePerformanceResults(result(), baseline);
    assert.equal(comparison.status, "incompatible");
    assert.equal(comparison.metrics, null);
    assert.equal(comparison.reasons.length, 1);
  }
});

test("refuses an invalid otherwise-compatible baseline without losing the current result", () => {
  const baseline = result();
  delete baseline.build.total.rawBytes;
  const comparison = comparePerformanceResults(result(), baseline);
  assert.equal(comparison.status, "incompatible");
  assert.deepEqual(comparison.reasons, [{ code: "baseline-invalid" }]);
});

test("does not invent a percentage when the baseline is zero", () => {
  const baseline = result();
  const current = result();
  baseline.build.total.rawBytes = 0;
  const totalRaw = comparePerformanceResults(current, baseline).metrics.sizes.find(
    (entry) => entry.id === "build.total.raw"
  );
  assert.equal(totalRaw.deltaPercent, null);
});

test("does not substitute a failed measurement with zero or a baseline value", () => {
  const current = result();
  current.timings[0] = {
    scenario: "startup-cold",
    status: "failed",
    error: "0/5 trials succeeded",
  };
  const comparison = comparePerformanceResults(current, result());
  assert.equal(comparison.status, "partial");
  assert.deepEqual(comparison.metrics.timings, []);
  assert.deepEqual(comparison.unavailable, [
    {
      section: "timings",
      scenario: "startup-cold",
      currentStatus: "failed",
      baselineStatus: "measured",
    },
  ]);
});

test("marks one-sided distribution sizes as unavailable", () => {
  const current = result();
  current.build.distributions.executable = { status: "measured", rawBytes: 1000 };
  const comparison = comparePerformanceResults(current, result());
  assert.equal(comparison.status, "partial");
  assert.deepEqual(comparison.unavailable, [
    {
      section: "sizes",
      scenario: "distribution.executable",
      currentStatus: "measured",
      baselineStatus: "not-measured",
    },
  ]);
  assert.equal(
    comparison.metrics.sizes.some((entry) => entry.id === "build.distributions.executable"),
    false
  );
});

test("escapes result-controlled Markdown content", () => {
  const current = result();
  current.timings.push({
    scenario: "unsafe|scenario",
    status: "failed",
    error: "<img src=https://example.invalid/a> ![remote](https://example.invalid/b)\nnext",
  });
  const markdown = performanceMarkdown(current);
  assert.doesNotMatch(markdown, /<img/);
  assert.match(markdown, /&lt;img src=https:\/\/example\\\.invalid\/a&gt;/);
  assert.match(markdown, /\\!\\\[remote\\\]\\\(https:\/\/example\\\.invalid\/b\\\)/);
  assert.match(markdown, /<code>unsafe\|scenario<\/code>/);
});

test("keeps acquired values and failure reasons in artifacts", (context) => {
  const artifactsDir = mkdtempSync(path.join(os.tmpdir(), "feathermd-report-test-"));
  context.after(() => rmSync(artifactsDir, { recursive: true, force: true }));
  const partial = result();
  partial.timings.push({
    scenario: "startup-warm",
    status: "failed",
    error: "2/5 trials succeeded",
  });
  partial.memory.push({ scenario: "rich", status: "not-measured", reason: "process-missing" });

  writePerformanceArtifacts({ result: partial, artifactsDir });

  const saved = JSON.parse(readFileSync(path.join(artifactsDir, "result.json"), "utf8"));
  assert.equal(saved.timings[0].status, "measured");
  assert.equal(saved.timings[1].error, "2/5 trials succeeded");
  const comparison = JSON.parse(readFileSync(path.join(artifactsDir, "comparison.json"), "utf8"));
  assert.equal(comparison.status, "not-requested");
  const summary = readFileSync(path.join(artifactsDir, "summary.md"), "utf8");
  assert.match(summary, /startup-warm.*2\/5 trials succeeded/);
  assert.match(summary, /rich.*process\\-missing/);
});

test("CLI compares saved results and writes machine-readable artifacts", (context) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "feathermd-report-cli-test-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const currentFile = path.join(root, "current.json");
  const baselineFile = path.join(root, "baseline.json");
  const outputDirectory = path.join(root, "output");
  writeFileSync(currentFile, JSON.stringify(result()));
  writeFileSync(baselineFile, JSON.stringify(result()));

  const cli = spawnSync(
    process.execPath,
    [reportScript, currentFile, baselineFile, outputDirectory],
    { encoding: "utf8" }
  );

  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).status, "comparable");
  const comparison = JSON.parse(
    readFileSync(path.join(outputDirectory, "comparison.json"), "utf8")
  );
  assert.equal(comparison.status, "comparable");
});
