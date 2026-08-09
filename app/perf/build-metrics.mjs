import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };
import { performanceMarkdown, writePerformanceArtifacts } from "./report.mjs";
import { FIXTURE_VERSION, PERFORMANCE_SCHEMA_VERSION } from "./schema.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PERF_MANIFEST_PATH = ".vite/perf-manifest.json";

const FEATURE_PATTERNS = {
  katex: /katex|markdown-it-katex/i,
  mermaid: /mermaid/i,
  shiki: /shiki|oniguruma|vscode-textmate/i,
};
const PRODUCTION_FORBIDDEN_MARKERS = [
  "perf-plain-marker-v1",
  "perf-rich-marker-v1",
  "perf-shiki-javascript-marker-v1",
  "perf-katex-marker-v1",
  "perf-mermaid-marker-v1",
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function classifyFile(file) {
  const extension = path.extname(file).toLowerCase();
  if ([".js", ".mjs"].includes(extension)) return "javascript";
  if (extension === ".css") return "css";
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp"].includes(extension)) {
    return "image";
  }
  if ([".woff", ".woff2", ".ttf", ".otf"].includes(extension)) return "font";
  return "other";
}

function sizeOf(bytes) {
  return {
    rawBytes: bytes.length,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

function summarize(files) {
  return files.reduce(
    (summary, file) => ({
      fileCount: summary.fileCount + 1,
      rawBytes: summary.rawBytes + file.rawBytes,
      brotliBytes: summary.brotliBytes + file.brotliBytes,
    }),
    { fileCount: 0, rawBytes: 0, brotliBytes: 0 }
  );
}

function collectOutputFiles(buildDir) {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`build output must not contain symlinks: ${absolute}`);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = toPosix(path.relative(buildDir, absolute));
      if (relative === PERF_MANIFEST_PATH) continue;
      const bytes = readFileSync(absolute);
      files.push({ file: relative, type: classifyFile(relative), ...sizeOf(bytes) });
    }
  }
  walk(buildDir);
  return files.sort((left, right) => left.file.localeCompare(right.file));
}

function resolveBuildFile(buildDir, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) {
    throw new Error(`manifest contains an invalid file path: ${relative}`);
  }
  const resolved = path.resolve(buildDir, relative);
  const root = path.resolve(buildDir) + path.sep;
  if (!resolved.startsWith(root))
    throw new Error(`manifest file escapes build output: ${relative}`);
  return resolved;
}

function validateManifest(buildDir, manifest, outputByName) {
  const fileOwners = new Map();
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk || typeof chunk !== "object" || typeof chunk.file !== "string") {
      throw new Error(`manifest entry ${key} has no output file`);
    }
    resolveBuildFile(buildDir, chunk.file);
    if (!outputByName.has(chunk.file)) throw new Error(`manifest output is missing: ${chunk.file}`);
    const existing = fileOwners.get(chunk.file);
    if (existing && existing !== key)
      throw new Error(`manifest output has duplicate owners: ${chunk.file}`);
    fileOwners.set(chunk.file, key);
    for (const dependency of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      if (!manifest[dependency]) throw new Error(`manifest dependency is missing: ${dependency}`);
    }
    for (const asset of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      resolveBuildFile(buildDir, asset);
      if (!outputByName.has(asset)) throw new Error(`manifest asset is missing: ${asset}`);
    }
  }
  const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
  if (entries.length === 0) throw new Error("manifest has no entry chunk");
  return fileOwners;
}

function collectHtmlInitialFiles(buildDir, outputFiles, outputByName, fileOwners) {
  const initialFiles = new Set();
  const rootChunks = new Set();
  const references = [];
  const referencePattern = /(?:src|href)=["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const output of outputFiles.filter(
    (file) => file.type === "other" && file.file.endsWith(".html")
  )) {
    const html = readFileSync(resolveBuildFile(buildDir, output.file), "utf8");
    for (const match of html.matchAll(referencePattern)) {
      const reference = match[1] ?? match[2];
      if (/^(?:[a-z]+:)?\/\//i.test(reference) || reference.startsWith("data:")) continue;
      const withoutSuffix = reference.split(/[?#]/, 1)[0];
      let decoded;
      try {
        decoded = decodeURIComponent(withoutSuffix);
      } catch {
        throw new Error(`HTML contains an invalid asset reference: ${reference}`);
      }
      const relative = decoded.startsWith("/")
        ? decoded.slice(1)
        : path.posix.normalize(path.posix.join(path.posix.dirname(output.file), decoded));
      if (!/[.](?:js|mjs|css)$/i.test(relative)) continue;
      references.push(relative);
    }
  }

  if (references.length === 0)
    throw new Error("build HTML has no initial JavaScript or CSS references");
  for (const reference of references) {
    resolveBuildFile(buildDir, reference);
    if (!outputByName.has(reference)) {
      throw new Error(`HTML initial asset is missing from build output: ${reference}`);
    }
    const owner = fileOwners.get(reference);
    if (owner) rootChunks.add(owner);
    else initialFiles.add(reference);
  }
  return { initialFiles, rootChunks };
}

function dependencyClosure(manifest, roots, dependencyFields) {
  const visited = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const key = queue.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) continue;
    for (const field of dependencyFields) queue.push(...(chunk[field] ?? []));
  }
  return visited;
}

function filesForChunks(manifest, chunkKeys) {
  const files = new Set();
  for (const key of chunkKeys) {
    const chunk = manifest[key];
    if (!chunk) continue;
    files.add(chunk.file);
    for (const stylesheet of chunk.css ?? []) files.add(stylesheet);
  }
  return files;
}

function summarizeNames(names, outputByName) {
  return summarize([...names].map((name) => outputByName.get(name)).filter(Boolean));
}

function collectDistributions(distributionPaths = {}) {
  const result = {};
  for (const kind of ["executable", "msi", "nsis", "portableZip"]) {
    const file = distributionPaths[kind];
    if (!file) {
      result[kind] = { status: "not-measured" };
      continue;
    }
    try {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`distribution must not be a symlink: ${kind}`);
      result[kind] = stat.isFile()
        ? { status: "measured", rawBytes: stat.size }
        : { status: "not-measured" };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      result[kind] = { status: "not-measured" };
    }
  }
  return result;
}

export function assertProductionOutputClean(buildDir) {
  const manifestPath = path.join(buildDir, ...PERF_MANIFEST_PATH.split("/"));
  if (existsSync(manifestPath))
    throw new Error("performance manifest leaked into production build");
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("production build contains a symbolic link");
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile() || !/[.](?:js|mjs|css|html|json)$/i.test(entry.name)) continue;
      const content = readFileSync(absolute, "utf8");
      const marker = PRODUCTION_FORBIDDEN_MARKERS.find((candidate) => content.includes(candidate));
      if (marker) throw new Error(`performance fixture leaked into production build: ${marker}`);
    }
  }
  walk(buildDir);
}

export function collectBuildMetrics({ buildDir, distributionPaths = {} }) {
  const manifestPath = path.join(buildDir, ...PERF_MANIFEST_PATH.split("/"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const outputFiles = collectOutputFiles(buildDir);
  const outputByName = new Map(outputFiles.map((file) => [file.file, file]));
  const fileOwners = validateManifest(buildDir, manifest, outputByName);
  const { initialFiles, rootChunks } = collectHtmlInitialFiles(
    buildDir,
    outputFiles,
    outputByName,
    fileOwners
  );
  const initialChunks = dependencyClosure(manifest, rootChunks, ["imports"]);
  for (const file of filesForChunks(manifest, initialChunks)) initialFiles.add(file);
  const manifestChunks = new Set(Object.keys(manifest));
  const manifestFiles = filesForChunks(manifest, manifestChunks);
  const lazyFiles = new Set([...manifestFiles].filter((file) => !initialFiles.has(file)));

  const byType = Object.fromEntries(
    ["javascript", "css", "image", "font", "other"].map((type) => [
      type,
      summarize(outputFiles.filter((file) => file.type === type)),
    ])
  );
  const featureGroups = {};
  for (const [feature, pattern] of Object.entries(FEATURE_PATTERNS)) {
    const roots = Object.keys(manifest).filter((key) =>
      pattern.test(`${key} ${manifest[key].file}`)
    );
    const chunks = dependencyClosure(manifest, roots, ["imports"]);
    featureGroups[feature] = summarizeNames(filesForChunks(manifest, chunks), outputByName);
  }

  return {
    total: summarize(outputFiles),
    byType,
    initial: summarizeNames(initialFiles, outputByName),
    lazy: summarizeNames(lazyFiles, outputByName),
    largestFiles: [...outputFiles]
      .sort((left, right) => right.rawBytes - left.rawBytes || left.file.localeCompare(right.file))
      .slice(0, 20),
    featureGroups,
    distributions: collectDistributions(distributionPaths),
  };
}

function gitValue(args, fallback) {
  try {
    return execFileSync("git", args, { cwd: path.resolve(appDir, ".."), encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

export function createBuildPerformanceResult(build) {
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    fixtureVersion: FIXTURE_VERSION,
    measuredAt: new Date().toISOString(),
    source: {
      commit: gitValue(["rev-parse", "HEAD"], "unknown"),
      appVersion: packageJson.version,
      dirty: gitValue(["status", "--porcelain"], "unknown") !== "",
    },
    environment: {
      id: `${os.platform()}-${os.arch()}-frontend-size`,
      os: `${os.platform()} ${os.release()}`,
      architecture: os.arch(),
      node: process.version,
      measurement: "build-size",
    },
    build: { ...build, type: "production-frontend" },
    timings: [],
    memory: [],
  };
}

export function buildMetricsMarkdown(result) {
  return performanceMarkdown(result);
}

export function writeBuildMetricsArtifacts({
  buildDir,
  artifactsDir,
  distributionPaths = {},
  baseline,
}) {
  const result = createBuildPerformanceResult(collectBuildMetrics({ buildDir, distributionPaths }));
  writePerformanceArtifacts({ result, baseline, artifactsDir });
  return result;
}
