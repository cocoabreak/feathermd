import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERF_MANIFEST_PATH,
  assertProductionOutputClean,
  writeBuildMetricsArtifacts,
} from "./build-metrics.mjs";
import { validatePerformanceFixtures } from "./fixtures.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(appDir, "build");
const artifactsDir = path.join(appDir, "perf", "artifacts");
const manifestPath = path.join(buildDir, ...PERF_MANIFEST_PATH.split("/"));
const svelteKitManifestPath = path.join(
  appDir,
  ".svelte-kit",
  "output",
  "client",
  ".vite",
  "manifest.json"
);
const npmExecPath = process.env.npm_execpath;

function runNpmBuild(environment) {
  if (!npmExecPath) throw new Error("perf:ci must be started from an npm script");
  const result = spawnSync(process.execPath, [npmExecPath, "run", "build"], {
    cwd: appDir,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm run build failed with exit code ${result.status}`);
}

let analysisError;
try {
  validatePerformanceFixtures();
  rmSync(buildDir, { recursive: true, force: true });
  runNpmBuild(process.env);
  if (!existsSync(svelteKitManifestPath)) throw new Error("SvelteKit client manifest is missing");
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  copyFileSync(svelteKitManifestPath, manifestPath);
  writeBuildMetricsArtifacts({ buildDir, artifactsDir });
} catch (error) {
  analysisError = error;
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}

runNpmBuild(process.env);
assertProductionOutputClean(buildDir);
if (analysisError) throw analysisError;
