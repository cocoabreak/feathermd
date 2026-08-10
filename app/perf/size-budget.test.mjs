import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSizeBudgetPassed,
  evaluateSizeBudget,
  sizeBudgetMarkdown,
  validateSizeBudget,
  writeSizeBudgetArtifacts,
} from "./size-budget.mjs";

const metricValues = {
  "build.total.rawBytes": 1000,
  "build.total.brotliBytes": 500,
  "build.initial.rawBytes": 200,
  "build.initial.brotliBytes": 100,
  "build.featureGroups.katex.rawBytes": 300,
  "build.featureGroups.katex.brotliBytes": 150,
  "build.featureGroups.mermaid.rawBytes": 400,
  "build.featureGroups.mermaid.brotliBytes": 200,
  "build.featureGroups.shiki.rawBytes": 250,
  "build.featureGroups.shiki.brotliBytes": 125,
};

function policy() {
  return {
    schemaVersion: 1,
    source: {
      baselineCommit: "a".repeat(40),
      measurements: 3,
      maxObservedVariationPercent: 0.027,
    },
    maxIncreasePercent: 5,
    baselines: { ...metricValues },
  };
}

function build(overrides = {}) {
  return {
    total: { rawBytes: 1000, brotliBytes: 500 },
    initial: { rawBytes: 200, brotliBytes: 100 },
    featureGroups: {
      katex: { rawBytes: 300, brotliBytes: 150 },
      mermaid: { rawBytes: 400, brotliBytes: 200 },
      shiki: { rawBytes: 250, brotliBytes: 125 },
    },
    ...overrides,
  };
}

test("passes values at the explicit five-percent ceilings", () => {
  const current = build({
    total: { rawBytes: 1050, brotliBytes: 525 },
    initial: { rawBytes: 210, brotliBytes: 105 },
    featureGroups: {
      katex: { rawBytes: 315, brotliBytes: 157 },
      mermaid: { rawBytes: 420, brotliBytes: 210 },
      shiki: { rawBytes: 262, brotliBytes: 131 },
    },
  });
  const assessment = evaluateSizeBudget(current, policy());
  assert.equal(assessment.status, "passed");
  assert.deepEqual(assessment.violations, []);
  assert.doesNotThrow(() => assertSizeBudgetPassed(assessment));
});

test("fails when any required metric exceeds its ceiling", () => {
  const assessment = evaluateSizeBudget(
    build({ total: { rawBytes: 1051, brotliBytes: 500 } }),
    policy()
  );
  assert.equal(assessment.status, "failed");
  assert.deepEqual(assessment.violations, ["build.total.rawBytes"]);
  assert.throws(() => assertSizeBudgetPassed(assessment), /1051 > 1050/);
});

test("rejects missing, unknown, and invalid policy metrics", () => {
  const missing = policy();
  delete missing.baselines["build.initial.rawBytes"];
  assert.throws(() => validateSizeBudget(missing), /positive integer.*build.initial.rawBytes/);

  const unknown = policy();
  unknown.baselines["build.unknown.rawBytes"] = 1;
  assert.throws(() => validateSizeBudget(unknown), /unsupported metric/);

  const unstable = policy();
  unstable.maxIncreasePercent = 0.01;
  assert.throws(() => validateSizeBudget(unstable), /must exceed the observed variation/);
});

test("rejects missing or invalid current metrics instead of treating them as zero", () => {
  const missing = build();
  delete missing.featureGroups.mermaid;
  assert.throws(() => evaluateSizeBudget(missing, policy()), /mermaid.rawBytes/);

  const invalid = build({ initial: { rawBytes: -1, brotliBytes: 100 } });
  assert.throws(() => evaluateSizeBudget(invalid, policy()), /initial.rawBytes/);

  const unclassified = build();
  unclassified.featureGroups.shiki = { rawBytes: 0, brotliBytes: 0 };
  assert.throws(() => evaluateSizeBudget(unclassified, policy()), /shiki.rawBytes/);
});

test("writes reviewable JSON and Markdown artifacts before CI failure", (context) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "feathermd-size-budget-test-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const assessment = evaluateSizeBudget(
    build({ initial: { rawBytes: 211, brotliBytes: 100 } }),
    policy()
  );
  writeSizeBudgetArtifacts({ assessment, artifactsDir: root });

  const json = JSON.parse(readFileSync(path.join(root, "size-budget.json"), "utf8"));
  const markdown = readFileSync(path.join(root, "size-budget.md"), "utf8");
  assert.equal(json.status, "failed");
  assert.match(markdown, /Initial graph raw.*fail/);
  assert.match(sizeBudgetMarkdown(assessment), /Maximum increase: 5%/);
});
