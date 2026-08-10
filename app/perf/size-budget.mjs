import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SIZE_BUDGET_SCHEMA_VERSION = 1;

const METRICS = [
  ["build.total.rawBytes", "All output raw", (build) => build?.total?.rawBytes],
  ["build.total.brotliBytes", "All output Brotli", (build) => build?.total?.brotliBytes],
  ["build.initial.rawBytes", "Initial graph raw", (build) => build?.initial?.rawBytes],
  ["build.initial.brotliBytes", "Initial graph Brotli", (build) => build?.initial?.brotliBytes],
  [
    "build.featureGroups.katex.rawBytes",
    "KaTeX group raw",
    (build) => build?.featureGroups?.katex?.rawBytes,
  ],
  [
    "build.featureGroups.katex.brotliBytes",
    "KaTeX group Brotli",
    (build) => build?.featureGroups?.katex?.brotliBytes,
  ],
  [
    "build.featureGroups.mermaid.rawBytes",
    "Mermaid group raw",
    (build) => build?.featureGroups?.mermaid?.rawBytes,
  ],
  [
    "build.featureGroups.mermaid.brotliBytes",
    "Mermaid group Brotli",
    (build) => build?.featureGroups?.mermaid?.brotliBytes,
  ],
  [
    "build.featureGroups.shiki.rawBytes",
    "Shiki group raw",
    (build) => build?.featureGroups?.shiki?.rawBytes,
  ],
  [
    "build.featureGroups.shiki.brotliBytes",
    "Shiki group Brotli",
    (build) => build?.featureGroups?.shiki?.brotliBytes,
  ],
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertFinitePercentage(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a finite percentage between 0 and 100`);
  }
}

export function validateSizeBudget(policy) {
  if (!isRecord(policy)) throw new Error("size budget must be an object");
  if (policy.schemaVersion !== SIZE_BUDGET_SCHEMA_VERSION) {
    throw new Error(`unsupported size budget schema: ${policy.schemaVersion}`);
  }
  if (!isRecord(policy.source)) throw new Error("size budget source must be an object");
  if (!/^[0-9a-f]{40}$/.test(policy.source.baselineCommit)) {
    throw new Error("size budget baseline commit must be a full lowercase Git commit");
  }
  if (!Number.isSafeInteger(policy.source.measurements) || policy.source.measurements < 2) {
    throw new Error("size budget source measurements must be an integer of at least 2");
  }
  assertFinitePercentage(
    policy.source.maxObservedVariationPercent,
    "size budget maximum observed variation"
  );
  assertFinitePercentage(policy.maxIncreasePercent, "size budget maximum increase");
  if (policy.maxIncreasePercent <= policy.source.maxObservedVariationPercent) {
    throw new Error("size budget maximum increase must exceed the observed variation");
  }
  if (!isRecord(policy.baselines)) throw new Error("size budget baselines must be an object");

  const requiredIds = new Set(METRICS.map(([id]) => id));
  for (const id of Object.keys(policy.baselines)) {
    if (!requiredIds.has(id)) throw new Error(`size budget contains an unsupported metric: ${id}`);
  }
  for (const id of requiredIds) {
    const value = policy.baselines[id];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`size budget baseline must be a positive integer: ${id}`);
    }
  }
  return policy;
}

export function loadSizeBudget(file) {
  let policy;
  try {
    policy = JSON.parse(readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new Error(`failed to read size budget: ${error.message}`, { cause: error });
  }
  return validateSizeBudget(policy);
}

export function evaluateSizeBudget(build, policy) {
  validateSizeBudget(policy);
  const metrics = METRICS.map(([id, label, read]) => {
    const currentBytes = read(build);
    if (!Number.isSafeInteger(currentBytes) || currentBytes <= 0) {
      throw new Error(`size budget metric is missing or invalid: ${id}`);
    }
    const baselineBytes = policy.baselines[id];
    const limitBytes = Math.ceil(baselineBytes * (1 + policy.maxIncreasePercent / 100));
    return {
      id,
      label,
      currentBytes,
      baselineBytes,
      limitBytes,
      deltaBytes: currentBytes - baselineBytes,
      deltaPercent: ((currentBytes - baselineBytes) / baselineBytes) * 100,
      withinLimit: currentBytes <= limitBytes,
    };
  });
  const violations = metrics.filter((metric) => !metric.withinLimit).map((metric) => metric.id);
  return {
    schemaVersion: SIZE_BUDGET_SCHEMA_VERSION,
    status: violations.length === 0 ? "passed" : "failed",
    source: policy.source,
    maxIncreasePercent: policy.maxIncreasePercent,
    metrics,
    violations,
  };
}

function formatBytes(value) {
  return `${value.toLocaleString("en-US")} B`;
}

function formatPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}%`;
}

export function sizeBudgetMarkdown(assessment) {
  return [
    "# Frontend size budget",
    "",
    `- Status: ${assessment.status}`,
    `- Baseline commit: \`${assessment.source.baselineCommit}\``,
    `- Maximum increase: ${assessment.maxIncreasePercent}%`,
    `- Maximum observed variation: ${assessment.source.maxObservedVariationPercent}%`,
    "",
    "| Metric | Current | Baseline | Limit | Delta | Result |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...assessment.metrics.map(
      (metric) =>
        `| ${metric.label} | ${formatBytes(metric.currentBytes)} | ${formatBytes(metric.baselineBytes)} | ${formatBytes(metric.limitBytes)} | ${formatPercent(metric.deltaPercent)} | ${metric.withinLimit ? "pass" : "fail"} |`
    ),
    "",
  ].join("\n");
}

export function writeSizeBudgetArtifacts({ assessment, artifactsDir }) {
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(
    path.join(artifactsDir, "size-budget.json"),
    `${JSON.stringify(assessment, null, 2)}\n`
  );
  writeFileSync(path.join(artifactsDir, "size-budget.md"), sizeBudgetMarkdown(assessment));
}

export function assertSizeBudgetPassed(assessment) {
  if (assessment.status === "passed") return;
  const details = assessment.metrics
    .filter((metric) => !metric.withinLimit)
    .map((metric) => `${metric.id}=${metric.currentBytes} > ${metric.limitBytes}`)
    .join(", ");
  throw new Error(`frontend size budget exceeded: ${details}`);
}
