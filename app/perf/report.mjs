import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublicResultSafe, validatePerformanceResult } from "./schema.mjs";

const COMPARISON_IDENTITIES = [
  ["schema-version", (result) => result?.schemaVersion],
  ["fixture-version", (result) => result?.fixtureVersion],
  ["environment-id", (result) => result?.environment?.id],
  ["build-type", (result) => result?.build?.type],
];

function metric(id, label, unit, current, baseline) {
  const delta = current - baseline;
  return {
    id,
    label,
    unit,
    current,
    baseline,
    delta,
    deltaPercent: baseline === 0 ? null : (delta / baseline) * 100,
  };
}

function addSizeSummary(metrics, id, label, current, baseline) {
  metrics.push(
    metric(`${id}.raw`, `${label} raw`, "bytes", current.rawBytes, baseline.rawBytes),
    metric(`${id}.brotli`, `${label} Brotli`, "bytes", current.brotliBytes, baseline.brotliBytes)
  );
}

function measuredByScenario(entries) {
  return new Map(
    entries.filter((entry) => entry.status === "measured").map((entry) => [entry.scenario, entry])
  );
}

function collectUnavailableScenarios(section, currentEntries, baselineEntries) {
  const currentByScenario = new Map(currentEntries.map((entry) => [entry.scenario, entry]));
  const baselineByScenario = new Map(baselineEntries.map((entry) => [entry.scenario, entry]));
  return [...new Set([...currentByScenario.keys(), ...baselineByScenario.keys()])].flatMap(
    (scenario) => {
      const currentStatus = currentByScenario.get(scenario)?.status ?? "missing";
      const baselineStatus = baselineByScenario.get(scenario)?.status ?? "missing";
      return currentStatus === "measured" && baselineStatus === "measured"
        ? []
        : [{ section, scenario, currentStatus, baselineStatus }];
    }
  );
}

function collectUnavailableDistributions(current, baseline) {
  return Object.keys(current).flatMap((kind) => {
    const currentStatus = current[kind].status;
    const baselineStatus = baseline[kind].status;
    return currentStatus === baselineStatus
      ? []
      : [{ section: "sizes", scenario: `distribution.${kind}`, currentStatus, baselineStatus }];
  });
}

function collectComparisonMetrics(current, baseline) {
  const sizes = [];
  for (const [id, label] of [
    ["total", "All output"],
    ["initial", "Initial graph"],
    ["lazy", "Lazy graph"],
  ]) {
    addSizeSummary(sizes, `build.${id}`, label, current.build[id], baseline.build[id]);
  }
  for (const group of ["byType", "featureGroups"]) {
    for (const key of Object.keys(current.build[group])) {
      addSizeSummary(
        sizes,
        `build.${group}.${key}`,
        `${group}.${key}`,
        current.build[group][key],
        baseline.build[group][key]
      );
    }
  }
  for (const [kind, currentDistribution] of Object.entries(current.build.distributions)) {
    const baselineDistribution = baseline.build.distributions[kind];
    if (currentDistribution.status === "measured" && baselineDistribution.status === "measured") {
      sizes.push(
        metric(
          `build.distributions.${kind}`,
          `Distribution ${kind}`,
          "bytes",
          currentDistribution.rawBytes,
          baselineDistribution.rawBytes
        )
      );
    }
  }

  const timings = [];
  const baselineTimings = measuredByScenario(baseline.timings);
  for (const currentTiming of measuredByScenario(current.timings).values()) {
    const baselineTiming = baselineTimings.get(currentTiming.scenario);
    if (baselineTiming) {
      timings.push(
        metric(
          `timings.${currentTiming.scenario}`,
          currentTiming.scenario,
          "ms",
          currentTiming.medianMs,
          baselineTiming.medianMs
        )
      );
    }
  }

  const memory = [];
  const baselineMemory = measuredByScenario(baseline.memory);
  for (const currentMemory of measuredByScenario(current.memory).values()) {
    const baselineEntry = baselineMemory.get(currentMemory.scenario);
    if (!baselineEntry) continue;
    memory.push(
      metric(
        `memory.${currentMemory.scenario}.workingSet`,
        `${currentMemory.scenario} working set`,
        "bytes",
        currentMemory.workingSetBytes,
        baselineEntry.workingSetBytes
      ),
      metric(
        `memory.${currentMemory.scenario}.private`,
        `${currentMemory.scenario} private memory`,
        "bytes",
        currentMemory.privateMemoryBytes,
        baselineEntry.privateMemoryBytes
      )
    );
  }
  return { sizes, timings, memory };
}

export function comparePerformanceResults(current, baseline) {
  validatePerformanceResult(current);
  assertPublicResultSafe(current);
  if (baseline === undefined || baseline === null) {
    return { status: "not-requested", reasons: [], metrics: null };
  }
  const reasons = COMPARISON_IDENTITIES.flatMap(([code, read]) =>
    read(current) === read(baseline) ? [] : [{ code }]
  );
  if (reasons.length > 0) return { status: "incompatible", reasons, metrics: null };
  try {
    validatePerformanceResult(baseline);
    assertPublicResultSafe(baseline);
  } catch {
    return { status: "incompatible", reasons: [{ code: "baseline-invalid" }], metrics: null };
  }
  const unavailable = [
    ...collectUnavailableDistributions(current.build.distributions, baseline.build.distributions),
    ...collectUnavailableScenarios("timings", current.timings, baseline.timings),
    ...collectUnavailableScenarios("memory", current.memory, baseline.memory),
  ];
  return {
    status: unavailable.length === 0 ? "comparable" : "partial",
    reasons: [],
    metrics: collectComparisonMetrics(current, baseline),
    unavailable,
  };
}

function htmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/\r?\n/g, " ");
}

function markdownText(value) {
  return htmlText(value).replaceAll(/([\\`*_[\]{}()#+.!|>-])/g, "\\$1");
}

function inlineCode(value) {
  return `<code>${htmlText(value)}</code>`;
}

function formatNumber(value, unit) {
  const suffix = unit === "bytes" ? " B" : " ms";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 3 })}${suffix}`;
}

function formatDelta(value, unit) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, unit)}`;
}

function formatPercent(value) {
  if (value === null) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function comparisonTable(metrics) {
  return [
    "| Metric | Current | Baseline | Delta | Delta % |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...metrics.map(
      (entry) =>
        `| ${markdownText(entry.label)} | ${formatNumber(entry.current, entry.unit)} | ${formatNumber(entry.baseline, entry.unit)} | ${formatDelta(entry.delta, entry.unit)} | ${formatPercent(entry.deltaPercent)} |`
    ),
  ];
}

function incompleteMeasurements(result) {
  return [...result.timings, ...result.memory].filter((entry) => entry.status !== "measured");
}

export function performanceMarkdown(result, baseline, { reportMode = "report-only" } = {}) {
  if (!["report-only", "ci-threshold"].includes(reportMode)) {
    throw new Error(`unsupported performance report mode: ${reportMode}`);
  }
  const comparison = comparePerformanceResults(result, baseline);
  const lines = [
    "# Windows performance report",
    "",
    `- Commit: ${inlineCode(result.source.commit)}`,
    `- App version: ${inlineCode(result.source.appVersion)}`,
    `- Schema: ${inlineCode(result.schemaVersion)}`,
    `- Fixture: ${inlineCode(result.fixtureVersion)}`,
    `- Environment: ${inlineCode(result.environment.id)}`,
    `- Build type: ${inlineCode(result.build.type)}`,
    reportMode === "ci-threshold"
      ? "- Mode: CI size threshold enforced (see size-budget.md)"
      : "- Mode: report only (no CI threshold)",
    "",
    "## Build sizes",
    "",
    "| Scope | Files | Raw | Brotli |",
    "| --- | ---: | ---: | ---: |",
    ...[
      ["All output", result.build.total],
      ["Initial JS/CSS graph", result.build.initial],
      ["Lazy manifest graph", result.build.lazy],
    ].map(
      ([label, value]) =>
        `| ${label} | ${value.fileCount} | ${formatNumber(value.rawBytes, "bytes")} | ${formatNumber(value.brotliBytes, "bytes")} |`
    ),
    "",
    "## Feature groups",
    "",
    "| Feature | Files | Raw | Brotli |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(result.build.featureGroups).map(
      ([feature, value]) =>
        `| ${markdownText(feature)} | ${value.fileCount} | ${formatNumber(value.rawBytes, "bytes")} | ${formatNumber(value.brotliBytes, "bytes")} |`
    ),
    "",
    "## Largest files",
    "",
    "| File | Type | Raw | Brotli |",
    "| --- | --- | ---: | ---: |",
    ...result.build.largestFiles.map(
      (file) =>
        `| ${inlineCode(file.file)} | ${markdownText(file.type)} | ${formatNumber(file.rawBytes, "bytes")} | ${formatNumber(file.brotliBytes, "bytes")} |`
    ),
    "",
  ];

  const incomplete = incompleteMeasurements(result);
  if (incomplete.length > 0) {
    lines.push(
      "## Incomplete measurements",
      "",
      ...incomplete.map(
        (entry) =>
          `- ${inlineCode(entry.scenario)}: ${markdownText(entry.status)} (${markdownText(entry.error ?? entry.reason)})`
      ),
      ""
    );
  }

  lines.push("## Baseline comparison", "");
  if (comparison.status === "not-requested") {
    lines.push("No baseline was provided.", "");
  } else if (comparison.status === "incompatible") {
    lines.push(
      "The baseline is not comparable. No deltas were calculated.",
      "",
      ...comparison.reasons.map((reason) => `- ${reason.code}`),
      ""
    );
  } else {
    if (comparison.status === "partial") {
      lines.push(
        "Only measured values present in both results were compared.",
        "",
        ...comparison.unavailable.map(
          (entry) =>
            `- ${entry.section}.${markdownText(entry.scenario)}: current=${entry.currentStatus}, baseline=${entry.baselineStatus}`
        ),
        ""
      );
    }
    for (const [heading, metrics] of [
      ["Sizes", comparison.metrics.sizes],
      ["Timings", comparison.metrics.timings],
      ["Memory", comparison.metrics.memory],
    ]) {
      lines.push(`### ${heading}`, "");
      lines.push(...(metrics.length > 0 ? comparisonTable(metrics) : ["No comparable values."]));
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function writePerformanceArtifacts({ result, baseline, artifactsDir, reportMode }) {
  const comparison = comparePerformanceResults(result, baseline);
  const markdown = performanceMarkdown(result, baseline, { reportMode });
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(path.join(artifactsDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(
    path.join(artifactsDir, "comparison.json"),
    `${JSON.stringify(comparison, null, 2)}\n`
  );
  writeFileSync(path.join(artifactsDir, "summary.md"), markdown);
  return { result, comparison, markdown };
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new Error(`${label} JSON could not be read`, { cause: error });
  }
}

function runCli() {
  const [resultFile, baselineFile, outputDirectory] = process.argv.slice(2);
  if (!resultFile) {
    throw new Error("usage: report.mjs <result.json> [baseline.json|-] [output-directory]");
  }
  const resolvedResult = path.resolve(resultFile);
  const result = readJson(resolvedResult, "result");
  const baseline = baselineFile && baselineFile !== "-" ? readJson(baselineFile, "baseline") : null;
  const artifactsDir = outputDirectory
    ? path.resolve(outputDirectory)
    : path.dirname(resolvedResult);
  const written = writePerformanceArtifacts({ result, baseline, artifactsDir });
  process.stdout.write(`${JSON.stringify(written.comparison)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
