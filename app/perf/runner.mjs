import path from "node:path";
import { performanceExecutablePath, validatePerformanceOverlay } from "./build-app.mjs";
import {
  listProcessIdentities,
  namedMutexExists,
  queryRoamingAppData,
} from "./windows-process.mjs";

const LOOPBACK_ADDRESS = "127.0.0.1";
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
const PREPARED_PLAN = Symbol("prepared performance launch plan");

function assertWindows(platform) {
  if (platform !== "win32") {
    throw new Error("performance runner is supported on Windows only");
  }
}

function assertAbsoluteDirectory(directory, label) {
  if (typeof directory !== "string" || !path.win32.isAbsolute(directory)) {
    throw new Error(`${label} must be an absolute Windows path`);
  }
  const normalized = path.win32.normalize(directory);
  if (path.win32.dirname(normalized) === normalized) {
    throw new Error(`${label} must not be a filesystem root`);
  }
  return normalized;
}

function assertPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CDP port must be an integer between 1 and 65535");
  }
}

function isWithin(parent, candidate) {
  const relation = path.win32.relative(parent, candidate);
  return (
    relation === "" ||
    (!path.win32.isAbsolute(relation) && relation !== ".." && !relation.startsWith("..\\"))
  );
}

export function resolveIdentifierAppDataDir(identifier, appDataRoot) {
  if (
    typeof identifier !== "string" ||
    !IDENTIFIER_PATTERN.test(identifier) ||
    identifier.includes("..")
  ) {
    throw new Error("Tauri identifier is not safe for AppData resolution");
  }
  const normalizedRoot = assertAbsoluteDirectory(appDataRoot, "Roaming AppData");
  const resolved = path.win32.resolve(normalizedRoot, identifier);
  if (path.win32.relative(normalizedRoot, resolved) !== identifier) {
    throw new Error("resolved AppData directory escaped APPDATA");
  }
  return resolved;
}

export function createPerformanceLaunchPlan({
  port,
  runDir,
  executablePath = performanceExecutablePath,
  environment = process.env,
  platform = process.platform,
  roamingAppDataDir,
} = {}) {
  assertWindows(platform);
  assertPort(port);
  const normalizedRunDir = assertAbsoluteDirectory(runDir, "performance run directory");
  const normalizedExecutable = path.win32.normalize(executablePath);
  if (!path.win32.isAbsolute(normalizedExecutable)) {
    throw new Error("performance executable must be an absolute Windows path");
  }

  const { base, overlay } = validatePerformanceOverlay();
  const normalAppDataDir = resolveIdentifierAppDataDir(base.identifier, roamingAppDataDir);
  const performanceAppDataDir = resolveIdentifierAppDataDir(overlay.identifier, roamingAppDataDir);
  if (normalAppDataDir.toLowerCase() === performanceAppDataDir.toLowerCase()) {
    throw new Error("performance AppData must be isolated from the normal app");
  }

  const profileDir = path.win32.join(normalizedRunDir, "webview-profile");
  for (const protectedDir of [normalAppDataDir, performanceAppDataDir]) {
    if (isWithin(protectedDir, profileDir)) {
      throw new Error("WebView profile must be outside FeatherMD AppData");
    }
  }

  const env = { ...environment };
  delete env.FEATHERMD_E2E_DISABLE_SINGLE_INSTANCE;
  delete env.FEATHERMD_E2E_STATE_DIR;
  env.APPDATA = path.win32.normalize(roamingAppDataDir);
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port} --remote-debugging-address=${LOOPBACK_ADDRESS}`;
  env.WEBVIEW2_USER_DATA_FOLDER = profileDir;

  return {
    command: normalizedExecutable,
    args: [],
    options: {
      cwd: path.win32.dirname(normalizedExecutable),
      env,
      stdio: "ignore",
      windowsHide: true,
    },
    port,
    cdpOrigin: `http://${LOOPBACK_ADDRESS}:${port}`,
    runDir: normalizedRunDir,
    profileDir,
    normalAppDataDir,
    performanceAppDataDir,
    normalIdentifier: base.identifier,
    performanceIdentifier: overlay.identifier,
  };
}

export function preparePerformanceLaunch(
  options,
  {
    listProcesses = listProcessIdentities,
    mutexExists = namedMutexExists,
    getRoamingAppData = queryRoamingAppData,
  } = {}
) {
  const plan = createPerformanceLaunchPlan({
    ...options,
    roamingAppDataDir: getRoamingAppData(),
  });
  const existing = listProcesses("feathermd.exe");
  if (!Array.isArray(existing)) {
    throw new Error("FeatherMD process preflight returned an invalid result");
  }
  const existingMutex = [plan.normalIdentifier, plan.performanceIdentifier].some((identifier) =>
    mutexExists(`${identifier}-sim`)
  );
  if (existing.length > 0 || existingMutex) {
    throw new Error("FeatherMD is already running; performance launch was refused");
  }
  Object.defineProperty(plan, PREPARED_PLAN, { value: true });
  return plan;
}

export function assertPreparedPerformancePlan(plan) {
  if (plan?.[PREPARED_PLAN] !== true) {
    throw new Error("performance operation requires a successful existing-instance preflight");
  }
  return plan;
}
