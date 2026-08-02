import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const tauriDir = path.join(appDir, "src-tauri");
export const performanceConfigPath = path.join(tauriDir, "tauri.perf.conf.json");
export const performanceTargetDir = path.join(appDir, "perf", "artifacts", "tauri-target");
export const performanceExecutablePath = path.join(
  performanceTargetDir,
  "release",
  process.platform === "win32" ? "feathermd.exe" : "feathermd"
);

const baseConfigPath = path.join(tauriDir, "tauri.conf.json");
const allowedOverlayKeys = new Set(["$schema", "productName", "identifier"]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function assertExecutableContainsIdentifier(executable, identifier) {
  const bytes = Buffer.isBuffer(executable) ? executable : readFileSync(executable);
  const utf8 = Buffer.from(identifier, "utf8");
  const utf16 = Buffer.from(identifier, "utf16le");
  if (!bytes.includes(utf8) && !bytes.includes(utf16)) {
    throw new Error("performance executable does not contain its dedicated identifier");
  }
}

export function validatePerformanceOverlay() {
  const base = readJson(baseConfigPath);
  const overlay = readJson(performanceConfigPath);
  const unexpectedKeys = Object.keys(overlay).filter((key) => !allowedOverlayKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`performance config overrides forbidden keys: ${unexpectedKeys.join(", ")}`);
  }
  if (overlay.productName !== "FeatherMD Performance") {
    throw new Error("performance config must use the dedicated product name");
  }
  if (
    typeof overlay.identifier !== "string" ||
    overlay.identifier.length === 0 ||
    overlay.identifier === base.identifier
  ) {
    throw new Error("performance config must use a dedicated identifier");
  }
  return { base, overlay };
}

export function performanceBuildPlan(environment = process.env) {
  const npmExecPath = environment.npm_execpath;
  if (!npmExecPath) throw new Error("perf:build-app must be started from an npm script");
  const env = {
    ...environment,
    CARGO_TARGET_DIR: performanceTargetDir,
  };
  delete env.FEATHERMD_E2E_DISABLE_SINGLE_INSTANCE;
  delete env.FEATHERMD_E2E_STATE_DIR;
  return {
    command: process.execPath,
    args: [
      npmExecPath,
      "run",
      "tauri",
      "--",
      "build",
      "--config",
      performanceConfigPath,
      "--no-bundle",
    ],
    options: { cwd: appDir, env, stdio: "inherit" },
  };
}

export function buildPerformanceApp() {
  if (process.platform !== "win32") {
    throw new Error("performance release builds are supported on Windows only");
  }
  const { overlay } = validatePerformanceOverlay();
  const { command, args, options } = performanceBuildPlan();
  const result = spawnSync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`performance release build failed with exit code ${result.status}`);
  }
  if (!existsSync(performanceExecutablePath)) {
    throw new Error(`performance executable is missing: ${performanceExecutablePath}`);
  }
  assertExecutableContainsIdentifier(performanceExecutablePath, overlay.identifier);
  return performanceExecutablePath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${buildPerformanceApp()}\n`);
}
