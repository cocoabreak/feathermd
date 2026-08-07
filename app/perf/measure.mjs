import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { WebView2Driver, findFreePort } from "../scripts/webview2-driver.mjs";
import {
  startFixtureReplacementObservation,
  waitForFixtureReplacement,
  waitForPerformanceFixture,
} from "./fixture-render.mjs";
import { materializePerformanceFixture, validatePerformanceFixtures } from "./fixtures.mjs";
import { collectStableProcessTreeMemory } from "./memory.mjs";
import { preparePerformanceLaunch } from "./runner.mjs";
import { cleanupPerformanceWorkspace, createPerformanceWorkspace } from "./run-workspace.mjs";
import { launchPerformanceJob } from "./windows-job.mjs";
import {
  assertOwnedCdpProcess,
  listProcessIdentities,
  queryLoopbackListenerOwner,
  queryProcessDetails,
  queryProcessIdentity,
} from "./windows-process.mjs";

const STORE_NAMES = ["settings.json", "tabs.json", "recent.json", "trusted-root.json"];
const STORE_PROBE_NAME = "store-isolation-probe.md";
const RECENT_MARKER_TITLE = "performance-store-marker";
export function isProductionTauriUrl(value) {
  try {
    const url = new URL(value);
    const mainDocument =
      (url.pathname === "/" || url.pathname === "/index.html") &&
      url.search === "" &&
      url.hash === "";
    return (
      mainDocument &&
      (((url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname === "tauri.localhost" &&
        url.port === "") ||
        (url.protocol === "tauri:" && url.hostname === "localhost" && url.port === ""))
    );
  } catch {
    return false;
  }
}

export function assertNoForeignFeatherMdProcesses(appIdentity, identities) {
  assert.ok(appIdentity, "performance app identity is missing");
  assert.ok(Array.isArray(identities), "FeatherMD background process query is invalid");
  const foreign = identities.filter(
    (identity) =>
      identity.pid !== appIdentity.pid ||
      identity.creationTime !== appIdentity.creationTime ||
      identity.executablePath !== appIdentity.executablePath
  );
  assert.equal(foreign.length, 0, "another FeatherMD process started after performance preflight");
}

export function createFeatherMdBackgroundGuard(appIdentity, listProcesses = listProcessIdentities) {
  return () => assertNoForeignFeatherMdProcesses(appIdentity, listProcesses("feathermd.exe"));
}

export function seedPerformanceStores(workspace, write = writeFileSync) {
  const stores = {
    "settings.json": {
      settings: { language: "en", theme: "dark", checkForUpdatesOnStartup: false },
    },
    "tabs.json": { tabs: [], activeIndex: null, explorer: null, expandedDirs: [] },
    "recent.json": {
      files: [],
      folders: [{ path: workspace.performanceAppDataDir, title: RECENT_MARKER_TITLE }],
      archives: [],
    },
    "trusted-root.json": { root: workspace.performanceAppDataDir.replaceAll("\\", "/") },
  };
  for (const [name, value] of Object.entries(stores)) {
    write(path.win32.join(workspace.performanceAppDataDir, name), JSON.stringify(value));
  }
  const probePath = path.win32.join(workspace.performanceAppDataDir, STORE_PROBE_NAME);
  write(probePath, "# performance store isolation probe\n");
  return probePath;
}

async function assertTrustedRootLoaded(driver, probePath) {
  const result = await driver.evaluate(
    `window.__TAURI_INTERNALS__.invoke("stat_path", { path: ${JSON.stringify(probePath)} })`
  );
  assert.equal(result?.is_file, true, "performance trusted root store was not restored");
}

async function assertPerformanceStoresLoaded(driver, workspace) {
  const deadline = Date.now() + 5_000;
  let state;
  do {
    state = await driver.evaluate(`Promise.all([
      window.__TAURI_INTERNALS__.invoke("load_app_state", { kind: "settings" }),
      window.__TAURI_INTERNALS__.invoke("load_app_state", { kind: "tabs" }),
      window.__TAURI_INTERNALS__.invoke("load_app_state", { kind: "recent" })
    ])`);
    if (state?.[1]?.tabs?.length === 2) break;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.equal(state?.[0]?.settings?.language, "en", "performance settings store was not loaded");
  assert.equal(state?.[0]?.settings?.theme, "dark", "performance settings marker was not loaded");
  assert.equal(state?.[1]?.tabs?.length, 2, "performance tabs store was not updated");
  assert.ok(
    state[1].tabs.every(
      (tab) =>
        path.win32.normalize(tab.source?.nativePath) === path.win32.normalize(workspace.runDir)
    ),
    "performance tabs escaped the owned run directory"
  );
  assert.ok(
    state?.[2]?.folders?.some((entry) => entry.title === RECENT_MARKER_TITLE),
    "performance recent store marker was not loaded"
  );
}

function snapshotStores(directory) {
  return Object.fromEntries(
    STORE_NAMES.map((name) => {
      const file = path.win32.join(directory, name);
      if (!existsSync(file)) return [name, null];
      const stat = statSync(file);
      return [
        name,
        {
          sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        },
      ];
    })
  );
}

function isSharingViolation(error) {
  return ["EBUSY", "EACCES", "EPERM"].includes(error.code);
}

function assertFixtureLeaseProtection(file, runDirectory) {
  let descriptor;
  try {
    descriptor = openSync(file, "r+");
  } catch (error) {
    if (!isSharingViolation(error)) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (descriptor !== undefined) {
    throw new Error("performance fixture lease allowed a concurrent writer");
  }

  const moved = `${runDirectory}.lease-test`;
  try {
    renameSync(runDirectory, moved);
  } catch (error) {
    if (isSharingViolation(error)) return;
    throw error;
  }
  renameSync(moved, runDirectory);
  throw new Error("performance fixture lease allowed its run directory to be renamed");
}

function elapsedMs(start, end) {
  const value = end - start;
  assert.ok(Number.isFinite(value) && value >= 0, "performance duration is invalid");
  return Number(value.toFixed(3));
}

async function waitForNewActiveTab(driver, previousTabId, expectedTitle) {
  await driver.waitFor(
    `(() => {
      const active = document.querySelector("[data-tab-id].bg-background");
      const title = active?.querySelector("[data-tab-drag-handle]")?.textContent.trim();
      return active?.dataset.tabId !== ${JSON.stringify(previousTabId)} &&
        title === ${JSON.stringify(expectedTitle)};
    })()`,
    { timeoutMs: 30_000 }
  );
  await driver.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))"
  );
  return driver.evaluate(
    'document.querySelector("[data-tab-id].bg-background")?.dataset.tabId ?? null'
  );
}

export async function finishPerformanceLaunch(
  fixtureLeases,
  job,
  workspace,
  cleanupSafe,
  cleanupWorkspace = cleanupPerformanceWorkspace
) {
  const errors = [];
  for (const fixtureLease of [...fixtureLeases].reverse()) {
    try {
      await fixtureLease.release();
    } catch (error) {
      if (error?.performanceWorkspaceCleanupSafe === false) cleanupSafe = false;
      errors.push(error);
    }
  }
  if (job) {
    try {
      await job.close();
    } catch (error) {
      cleanupSafe = cleanupSafe && job.terminationConfirmed;
      if (!cleanupSafe) error.performanceWorkspaceCleanupSafe = false;
      errors.push(error);
    }
  }
  if (workspace && cleanupSafe) {
    try {
      cleanupWorkspace(workspace);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function throwPerformanceErrors(operationError, cleanupErrors, cleanupSafe) {
  const errors = operationError ? [operationError, ...cleanupErrors] : cleanupErrors;
  if (errors.length === 0) return;
  const error =
    errors.length === 1 ? errors[0] : new AggregateError(errors, "performance launch failed");
  const workspaceCleanupSafe =
    cleanupSafe &&
    !errors.some((candidate) => candidate?.performanceWorkspaceCleanupSafe === false);
  if (!workspaceCleanupSafe || cleanupErrors.length > 0) {
    error.performanceTrialContinuationSafe = false;
  }
  if (!workspaceCleanupSafe) error.performanceWorkspaceCleanupSafe = false;
  throw error;
}

export async function launchReadyPerformanceApp(workspace) {
  let job;
  let cleanupSafe = true;
  try {
    const startupRequestedAt = performance.now();
    job = await launchPerformanceJob(workspace);
    const appIdentity = queryProcessIdentity(job.pid);
    assert.ok(appIdentity, "performance app process disappeared before identity capture");
    assert.equal(
      appIdentity.executablePath,
      path.win32.normalize(workspace.command).toLowerCase(),
      "Job-owned PID does not match the performance executable"
    );
    const assertBackgroundCondition = createFeatherMdBackgroundGuard(appIdentity);
    assertBackgroundCondition();

    const driver = new WebView2Driver({ port: workspace.port });
    await driver.waitForCdp(90_000);
    const listenerPid = queryLoopbackListenerOwner(workspace.port);
    assert.equal(job.contains(listenerPid), true, "CDP listener is outside the performance Job");
    const listenerProcess = queryProcessDetails(listenerPid);
    assertOwnedCdpProcess({
      appIdentity,
      listenerProcess,
      profileDir: workspace.profileDir,
      port: workspace.port,
    });

    const targets = (await driver.targets()).filter((candidate) =>
      isProductionTauriUrl(candidate.url ?? "")
    );
    assert.equal(targets.length, 1, "performance CDP target is ambiguous");
    const productionDriver = new WebView2Driver({ port: workspace.port, devUrl: targets[0].url });
    await productionDriver.waitFor('document.readyState === "complete" && document.body !== null', {
      timeoutMs: 30_000,
    });
    const page = await productionDriver.evaluate(`({
      readyState: document.readyState,
      productionHookAbsent: window.__e2e === undefined,
      bodyChildren: document.body.children.length,
      origin: location.origin
    })`);
    assert.equal(page.readyState, "complete");
    assert.equal(page.productionHookAbsent, true);
    assert.ok(page.bodyChildren > 0);
    assert.equal(isProductionTauriUrl(page.origin), true);
    await productionDriver.key("Ctrl+Shift+P");
    await productionDriver.waitFor(
      'document.querySelector(\'[role="dialog"] [role="listbox"]\') !== null',
      { timeoutMs: 10_000 }
    );
    const startupReadyAt = performance.now();
    assert.equal(await productionDriver.click(".picker-backdrop"), "OK");
    await productionDriver.waitFor("document.querySelector('[role=\"dialog\"]') === null", {
      timeoutMs: 10_000,
    });
    const initialTabId = await productionDriver.evaluate(
      'document.querySelector("[data-tab-id].bg-background")?.dataset.tabId ?? null'
    );
    assert.equal(initialTabId, null, "performance session did not start empty");
    assertBackgroundCondition();
    return {
      job,
      productionDriver,
      appIdentity,
      listenerProcess,
      assertBackgroundCondition,
      startupRequestedAt,
      startupReadyAt,
      initialTabId,
    };
  } catch (error) {
    if (error?.performanceWorkspaceCleanupSafe === false) {
      cleanupSafe = false;
    }
    const cleanupErrors = await finishPerformanceLaunch([], job, undefined, cleanupSafe);
    throwPerformanceErrors(error, cleanupErrors, cleanupSafe);
  }
}

const MEMORY_FIXTURE_IDS = {
  empty: null,
  plain: "plain-v1",
  rich: "rich-v1",
};

export async function measurePerformanceMemoryScenario(
  { scenario } = {},
  {
    allocatePort = findFreePort,
    prepareLaunch = preparePerformanceLaunch,
    createWorkspace = createPerformanceWorkspace,
    launchReady = launchReadyPerformanceApp,
    collectMemory = collectStableProcessTreeMemory,
    materializeFixture = materializePerformanceFixture,
    waitForTab = waitForNewActiveTab,
    waitForFixture = waitForPerformanceFixture,
    finish = finishPerformanceLaunch,
  } = {}
) {
  if (!Object.hasOwn(MEMORY_FIXTURE_IDS, scenario)) {
    throw new Error("unsupported performance memory scenario");
  }
  const fixtureId = MEMORY_FIXTURE_IDS[scenario];
  const fixture = fixtureId
    ? validatePerformanceFixtures().find((candidate) => candidate.id === fixtureId)
    : null;
  if (fixtureId) assert.ok(fixture, `performance fixture is unavailable: ${fixtureId}`);

  let workspace;
  let job;
  const fixtureLeases = [];
  let cleanupSafe = true;
  let result;
  let operationError;
  try {
    const port = await allocatePort();
    const plan = prepareLaunch({
      port,
      runDir: path.win32.join(os.tmpdir(), "feathermd-performance-memory-planned"),
    });
    workspace = createWorkspace(plan);
    const materializedFixture = fixture ? materializeFixture(workspace, fixture) : null;
    const launch = await launchReady(workspace);
    job = launch.job;
    if (materializedFixture) {
      launch.assertBackgroundCondition();
      const fixtureLease = await job.openFixture(materializedFixture);
      fixtureLeases.push(fixtureLease);
      await waitForTab(launch.productionDriver, launch.initialTabId, materializedFixture.fileName);
      await waitForFixture(launch.productionDriver, materializedFixture);
    }
    launch.assertBackgroundCondition();
    result = await collectMemory({
      scenario,
      rootIdentity: launch.appIdentity,
      requiredIdentities: [launch.listenerProcess],
      ownedProfileDir: workspace.profileDir,
    });
    launch.assertBackgroundCondition();
  } catch (error) {
    if (error?.performanceWorkspaceCleanupSafe === false) cleanupSafe = false;
    operationError = error;
  }
  const cleanupErrors = await finish(fixtureLeases, job, workspace, cleanupSafe);
  throwPerformanceErrors(operationError, cleanupErrors, cleanupSafe);
  return result;
}

export async function measurePerformanceWorkspaceStartup(
  workspace,
  { launchReady = launchReadyPerformanceApp, finish = finishPerformanceLaunch } = {}
) {
  let job;
  let result;
  let operationError;
  let cleanupSafe = true;
  try {
    const launch = await launchReady(workspace);
    job = launch.job;
    result = { startupMs: elapsedMs(launch.startupRequestedAt, launch.startupReadyAt) };
  } catch (error) {
    if (error?.performanceWorkspaceCleanupSafe === false) {
      cleanupSafe = false;
    }
    operationError = error;
  }
  const cleanupErrors = await finish([], job, undefined, cleanupSafe);
  throwPerformanceErrors(operationError, cleanupErrors, cleanupSafe);
  return result;
}

export async function verifyPerformanceLaunch({ fixtureId = "plain-v1" } = {}) {
  const fixture = validatePerformanceFixtures().find((candidate) => candidate.id === fixtureId);
  assert.ok(fixture, `performance fixture is unavailable: ${fixtureId}`);
  const port = await findFreePort();
  const plan = preparePerformanceLaunch({
    port,
    runDir: path.win32.join(os.tmpdir(), "feathermd-performance-planned"),
  });
  const normalStoresBefore = snapshotStores(plan.normalAppDataDir);
  let workspace;
  let job;
  const fixtureLeases = [];
  let cleanupSafe = true;
  let result;
  let operationError;
  try {
    workspace = createPerformanceWorkspace(plan);
    const storeProbePath = seedPerformanceStores(workspace);
    const firstFixture = materializePerformanceFixture(workspace, fixture);
    const repeatFixture = materializePerformanceFixture(workspace, fixture, { variant: "repeat" });
    const launch = await launchReadyPerformanceApp(workspace);
    job = launch.job;
    const {
      productionDriver,
      assertBackgroundCondition,
      startupRequestedAt,
      startupReadyAt,
      initialTabId,
    } = launch;

    assertBackgroundCondition();
    const firstRequestedAt = performance.now();
    const firstFixtureLease = await job.openFixture(firstFixture);
    fixtureLeases.push(firstFixtureLease);
    const firstTabId = await waitForNewActiveTab(
      productionDriver,
      initialTabId,
      firstFixture.fileName
    );
    await waitForPerformanceFixture(productionDriver, firstFixture);
    const firstRenderedAt = performance.now();
    assertFixtureLeaseProtection(firstFixture.path, workspace.runDir);

    assertBackgroundCondition();
    await startFixtureReplacementObservation(productionDriver, firstFixture);
    const repeatRequestedAt = performance.now();
    const repeatFixtureLease = await job.openFixture(repeatFixture);
    fixtureLeases.push(repeatFixtureLease);
    const repeatTabId = await waitForNewActiveTab(
      productionDriver,
      firstTabId,
      repeatFixture.fileName
    );
    assert.notEqual(repeatTabId, firstTabId, "repeat fixture reused the first tab");
    await waitForFixtureReplacement(productionDriver);
    await waitForPerformanceFixture(productionDriver, repeatFixture);
    const repeatRenderedAt = performance.now();
    assertBackgroundCondition();
    await assertTrustedRootLoaded(productionDriver, storeProbePath);
    await assertPerformanceStoresLoaded(productionDriver, workspace);
    assertFixtureLeaseProtection(firstFixture.path, workspace.runDir);
    assertFixtureLeaseProtection(repeatFixture.path, workspace.runDir);
    assert.ok(readdirSync(workspace.profileDir).length > 0, "WebView profile stayed empty");
    assert.deepEqual(
      snapshotStores(plan.normalAppDataDir),
      normalStoresBefore,
      "normal FeatherMD stores changed during performance launch"
    );

    result = {
      releaseStarted: true,
      cdpConnected: true,
      cdpOwnershipVerified: true,
      fixtureOpenedThroughCli: true,
      fixtureId: fixture.id,
      fixtureRendered: true,
      repeatFixtureRendered: true,
      fixtureLeaseProtected: true,
      productionHookAbsent: true,
      isolatedProfileCreated: true,
      normalStoresUnchanged: true,
      timings: {
        startupColdMs: elapsedMs(startupRequestedAt, startupReadyAt),
        readyToFixtureRequestMs: elapsedMs(startupReadyAt, firstRequestedAt),
        firstRenderMs: elapsedMs(firstRequestedAt, firstRenderedAt),
        repeatRenderMs: elapsedMs(repeatRequestedAt, repeatRenderedAt),
      },
    };
  } catch (error) {
    if (error?.performanceWorkspaceCleanupSafe === false) {
      cleanupSafe = false;
    }
    operationError = error;
  }
  const cleanupErrors = await finishPerformanceLaunch(fixtureLeases, job, workspace, cleanupSafe);
  throwPerformanceErrors(operationError, cleanupErrors, cleanupSafe);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPerformanceLaunch({ fixtureId: process.argv[2] ?? "plain-v1" });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
