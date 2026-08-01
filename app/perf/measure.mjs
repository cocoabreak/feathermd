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
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebView2Driver, findFreePort } from "../scripts/webview2-driver.mjs";
import { waitForPerformanceFixture } from "./fixture-render.mjs";
import { materializePerformanceFixture, validatePerformanceFixtures } from "./fixtures.mjs";
import { preparePerformanceLaunch } from "./runner.mjs";
import { cleanupPerformanceWorkspace, createPerformanceWorkspace } from "./run-workspace.mjs";
import { launchPerformanceJob } from "./windows-job.mjs";
import {
  assertOwnedCdpProcess,
  queryLoopbackListenerOwner,
  queryProcessDetails,
  queryProcessIdentity,
} from "./windows-process.mjs";

const STORE_NAMES = ["settings.json", "tabs.json", "recent.json", "trusted-root.json"];
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

export async function finishPerformanceLaunch(
  fixtureLease,
  job,
  workspace,
  cleanupSafe,
  cleanupWorkspace = cleanupPerformanceWorkspace
) {
  const errors = [];
  if (fixtureLease) {
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
  let fixtureLease;
  let cleanupSafe = true;
  let result;
  let operationError;
  try {
    workspace = createPerformanceWorkspace(plan);
    const materializedFixture = materializePerformanceFixture(workspace, fixture);
    job = await launchPerformanceJob(workspace);
    const appIdentity = queryProcessIdentity(job.pid);
    assert.ok(appIdentity, "performance app process disappeared before identity capture");
    assert.equal(
      appIdentity.executablePath,
      path.win32.normalize(workspace.command).toLowerCase(),
      "Job-owned PID does not match the performance executable"
    );

    const driver = new WebView2Driver({ port });
    await driver.waitForCdp(90_000);
    const listenerPid = queryLoopbackListenerOwner(port);
    assert.equal(job.contains(listenerPid), true, "CDP listener is outside the performance Job");
    const listenerProcess = queryProcessDetails(listenerPid);
    assertOwnedCdpProcess({
      appIdentity,
      listenerProcess,
      profileDir: workspace.profileDir,
      port,
    });

    const targets = (await driver.targets()).filter((candidate) =>
      isProductionTauriUrl(candidate.url ?? "")
    );
    assert.equal(targets.length, 1, "performance CDP target is ambiguous");
    const productionDriver = new WebView2Driver({ port, devUrl: targets[0].url });
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
    assert.equal(await productionDriver.click(".picker-backdrop"), "OK");
    await productionDriver.waitFor("document.querySelector('[role=\"dialog\"]') === null", {
      timeoutMs: 10_000,
    });
    fixtureLease = await job.openFixture(materializedFixture);
    assertFixtureLeaseProtection(materializedFixture.path, workspace.runDir);
    await waitForPerformanceFixture(productionDriver, materializedFixture);
    await fixtureLease.release();
    fixtureLease = undefined;
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
      fixtureLeaseProtected: true,
      productionHookAbsent: true,
      isolatedProfileCreated: true,
      normalStoresUnchanged: true,
    };
  } catch (error) {
    if (error?.performanceWorkspaceCleanupSafe === false) cleanupSafe = false;
    operationError = error;
  }
  const cleanupErrors = await finishPerformanceLaunch(fixtureLease, job, workspace, cleanupSafe);
  const errors = operationError ? [operationError, ...cleanupErrors] : cleanupErrors;
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "performance launch failed");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPerformanceLaunch({ fixtureId: process.argv[2] ?? "plain-v1" });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
