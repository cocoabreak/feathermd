import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMaterializedPerformanceFixture } from "./fixtures.mjs";
import { assertOwnedPerformanceWorkspace } from "./run-workspace.mjs";
import { windowsPowerShell } from "./windows-powershell.mjs";

const READY_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 30_000;
const FORCED_EXIT_TIMEOUT_MS = 5_000;
const jobHostScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "windows-job-host.ps1"
);
const jobMemberScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "windows-job-member.ps1"
);
const jobOpenScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "windows-job-open.ps1"
);
const workspaceLeaseScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "windows-workspace-lease.ps1"
);

function assertJobName(jobName) {
  if (!/^Local\\FeatherMD\.Performance\.[0-9a-f-]{36}$/.test(jobName)) {
    throw new Error("performance Job name is invalid");
  }
}

export function parseJobReady(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    throw new Error("Windows Job host returned invalid JSON");
  }
  if (!Number.isInteger(message.pid) || message.pid < 1) {
    throw new Error("Windows Job host returned an invalid PID");
  }
  return message;
}

export function performanceJobHostPlan(workspace, jobName) {
  assertOwnedPerformanceWorkspace(workspace);
  assertJobName(jobName);
  return {
    command: windowsPowerShell,
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      jobHostScript,
      "-Executable",
      workspace.command,
      "-WorkingDirectory",
      workspace.options.cwd,
      "-JobName",
      jobName,
    ],
    options: {
      cwd: workspace.options.cwd,
      env: workspace.options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  };
}

export function queryPerformanceJobMembership(jobName, pid, execute = spawnSync) {
  assertJobName(jobName);
  if (!Number.isInteger(pid) || pid < 1) throw new Error("Job member PID is invalid");
  const result = execute(
    windowsPowerShell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      jobMemberScript,
      "-JobName",
      jobName,
      "-ProcessId",
      String(pid),
    ],
    { encoding: "utf8", timeout: READY_TIMEOUT_MS, windowsHide: true }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Windows Job membership query failed (${result.status})`);
  }
  const value = result.stdout.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Windows Job membership query returned an invalid result");
}

export async function openPerformanceFixture(workspace, jobName, fixture, spawnProcess = spawn) {
  assertOwnedPerformanceWorkspace(workspace);
  assertJobName(jobName);
  assertMaterializedPerformanceFixture(fixture);
  if (
    path.win32.normalize(path.win32.dirname(fixture.path)).toLowerCase() !==
      path.win32.normalize(workspace.runDir).toLowerCase() ||
    path.win32.basename(fixture.path) !== fixture.fileName
  ) {
    throw new Error("materialized performance fixture is outside the owned workspace");
  }
  const host = spawnProcess(
    windowsPowerShell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      jobOpenScript,
      "-Executable",
      workspace.command,
      "-WorkingDirectory",
      workspace.options.cwd,
      "-JobName",
      jobName,
      "-OwnedRunDirectory",
      workspace.runDir,
      "-FixturePath",
      fixture.path,
      "-ExpectedSha256",
      fixture.sha256,
      "-ExpectedByteSize",
      String(fixture.byteSize),
    ],
    {
      cwd: workspace.options.cwd,
      env: workspace.options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  let stderr = "";
  host.stderr.setEncoding("utf8");
  host.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });
  try {
    await new Promise((resolve, reject) => {
      let stdout = "";
      const timer = globalThis.setTimeout(() => {
        finish(reject, new Error("performance fixture sender startup timed out"));
      }, READY_TIMEOUT_MS);
      const finish = (callback, value) => {
        globalThis.clearTimeout(timer);
        host.stdout.off("data", onData);
        host.off("error", onError);
        host.off("exit", onExit);
        callback(value);
      };
      const onData = (chunk) => {
        stdout += chunk.toString("utf8");
        const newline = stdout.indexOf("\n");
        if (newline < 0) return;
        try {
          const response = JSON.parse(stdout.slice(0, newline).trim());
          if (response.opened !== true) throw new Error("not opened");
          finish(resolve);
        } catch (error) {
          finish(
            reject,
            new Error("performance fixture sender returned an invalid result", { cause: error })
          );
        }
      };
      const onError = (error) => finish(reject, error);
      const onExit = (code) =>
        finish(
          reject,
          new Error(`performance fixture sender exited before ready (${code}): ${stderr}`)
        );
      host.stdout.on("data", onData);
      host.once("error", onError);
      host.once("exit", onExit);
    });
  } catch (error) {
    host.stdin.end("\n");
    host.kill();
    try {
      await waitForHostExit(host, FORCED_EXIT_TIMEOUT_MS, stderr, { requireSuccess: false });
    } catch (shutdownError) {
      const unsafeError = new AggregateError(
        [error, shutdownError],
        "performance fixture sender failed and termination was not confirmed",
        { cause: error }
      );
      unsafeError.performanceWorkspaceCleanupSafe = false;
      throw unsafeError;
    }
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      host.stdin.end("\n");
      try {
        await waitForHostExit(host, READY_TIMEOUT_MS, stderr);
      } catch (error) {
        if (host.exitCode === null && host.signalCode === null) {
          host.kill();
          try {
            await waitForHostExit(host, FORCED_EXIT_TIMEOUT_MS, stderr, {
              requireSuccess: false,
            });
          } catch (shutdownError) {
            const unsafeError = new AggregateError(
              [error, shutdownError],
              "performance fixture lease release failed and termination was not confirmed",
              { cause: error }
            );
            unsafeError.performanceWorkspaceCleanupSafe = false;
            throw unsafeError;
          }
        }
        throw error;
      }
    },
  };
}

export async function acquirePerformanceWorkspaceLease(workspace, spawnProcess = spawn) {
  assertOwnedPerformanceWorkspace(workspace);
  const host = spawnProcess(
    windowsPowerShell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      workspaceLeaseScript,
      "-RunDirectory",
      workspace.runDir,
      "-ProfileDirectory",
      workspace.profileDir,
      "-AppDataDirectory",
      workspace.performanceAppDataDir,
    ],
    {
      cwd: workspace.options.cwd,
      env: workspace.options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  let stderr = "";
  host.stderr.setEncoding("utf8");
  host.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });
  try {
    await new Promise((resolve, reject) => {
      let stdout = "";
      const timer = globalThis.setTimeout(
        () => finish(reject, new Error("performance workspace lease startup timed out")),
        READY_TIMEOUT_MS
      );
      const finish = (callback, value) => {
        globalThis.clearTimeout(timer);
        host.stdout.off("data", onData);
        host.off("error", onError);
        host.off("exit", onExit);
        callback(value);
      };
      const onData = (chunk) => {
        stdout += chunk.toString("utf8");
        const newline = stdout.indexOf("\n");
        if (newline < 0) return;
        try {
          const response = JSON.parse(stdout.slice(0, newline).trim());
          if (response.leased !== true) throw new Error("not leased");
          finish(resolve);
        } catch (error) {
          finish(
            reject,
            new Error("performance workspace lease returned an invalid result", { cause: error })
          );
        }
      };
      const onError = (error) => finish(reject, error);
      const onExit = (code) =>
        finish(
          reject,
          new Error(`performance workspace lease exited before ready (${code}): ${stderr}`)
        );
      host.stdout.on("data", onData);
      host.once("error", onError);
      host.once("exit", onExit);
    });
  } catch (error) {
    host.stdin.end("\n");
    host.kill();
    try {
      await waitForHostExit(host, FORCED_EXIT_TIMEOUT_MS, stderr, { requireSuccess: false });
    } catch (shutdownError) {
      const unsafeError = new AggregateError(
        [error, shutdownError],
        "performance workspace lease failed and termination was not confirmed"
      );
      unsafeError.performanceWorkspaceCleanupSafe = false;
      throw unsafeError;
    }
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      host.stdin.end("\n");
      try {
        await waitForHostExit(host, READY_TIMEOUT_MS, stderr);
      } catch (error) {
        if (host.exitCode === null && host.signalCode === null) host.kill();
        const unsafeError = new Error("performance workspace lease release failed", {
          cause: error,
        });
        unsafeError.performanceWorkspaceCleanupSafe = false;
        throw unsafeError;
      }
    },
  };
}

export function waitForHostExit(host, timeoutMs, stderr, { requireSuccess = true } = {}) {
  if (host.exitCode !== null || host.signalCode !== null) {
    if (!requireSuccess || host.exitCode === 0) return Promise.resolve();
    const status = host.exitCode ?? `signal ${host.signalCode}`;
    return Promise.reject(new Error(`Windows Job host shutdown failed (${status}): ${stderr}`));
  }
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("Windows Job host shutdown timed out"));
    }, timeoutMs);
    const cleanup = () => {
      globalThis.clearTimeout(timer);
      host.off("error", onError);
      host.off("exit", onExit);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code) => {
      cleanup();
      if (!requireSuccess || code === 0) resolve();
      else reject(new Error(`Windows Job host shutdown failed (${code}): ${stderr}`));
    };
    host.once("error", onError);
    host.once("exit", onExit);
  });
}

export async function launchPerformanceJob(workspace, spawnProcess = spawn) {
  const jobName = `Local\\FeatherMD.Performance.${randomUUID()}`;
  const plan = performanceJobHostPlan(workspace, jobName);
  const host = spawnProcess(plan.command, plan.args, plan.options);
  let stderr = "";
  host.stderr.setEncoding("utf8");
  host.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });

  let ready;
  try {
    ready = await new Promise((resolve, reject) => {
      let stdout = "";
      const timer = globalThis.setTimeout(() => {
        reject(new Error("Windows Job host startup timed out"));
      }, READY_TIMEOUT_MS);
      const finish = (callback, value) => {
        globalThis.clearTimeout(timer);
        host.stdout.off("data", onData);
        host.off("error", onError);
        host.off("exit", onExit);
        callback(value);
      };
      const onData = (chunk) => {
        stdout += chunk.toString("utf8");
        const newline = stdout.indexOf("\n");
        if (newline < 0) return;
        try {
          finish(resolve, parseJobReady(stdout.slice(0, newline).trim()));
        } catch (error) {
          finish(reject, error);
        }
      };
      const onError = (error) => finish(reject, error);
      const onExit = (code) =>
        finish(reject, new Error(`Windows Job host exited before ready (${code}): ${stderr}`));
      host.stdout.on("data", onData);
      host.once("error", onError);
      host.once("exit", onExit);
    });
  } catch (error) {
    host.stdin.end("\n");
    host.kill();
    try {
      await waitForHostExit(host, FORCED_EXIT_TIMEOUT_MS, stderr, { requireSuccess: false });
    } catch (shutdownError) {
      const unsafeError = new AggregateError(
        [shutdownError],
        "Windows Job host startup failed and termination was not confirmed",
        { cause: error }
      );
      unsafeError.performanceWorkspaceCleanupSafe = false;
      throw unsafeError;
    }
    throw error;
  }

  let closed = false;
  return {
    pid: ready.pid,
    get terminationConfirmed() {
      return host.exitCode !== null || host.signalCode !== null;
    },
    contains(pid) {
      return queryPerformanceJobMembership(jobName, pid);
    },
    openFixture(fixture) {
      return openPerformanceFixture(workspace, jobName, fixture);
    },
    async close() {
      if (closed) return;
      closed = true;
      host.stdin.end("\n");
      try {
        await waitForHostExit(host, EXIT_TIMEOUT_MS, stderr);
      } catch (error) {
        if (host.exitCode === null && host.signalCode === null) {
          host.kill();
          try {
            await waitForHostExit(host, FORCED_EXIT_TIMEOUT_MS, stderr, {
              requireSuccess: false,
            });
          } catch {
            // Report the original shutdown failure after the forced termination attempt.
          }
        }
        throw error;
      }
    },
  };
}
