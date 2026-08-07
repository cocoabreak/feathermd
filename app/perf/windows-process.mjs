import { spawnSync } from "node:child_process";
import path from "node:path";
import { windowsPowerShell } from "./windows-powershell.mjs";

const QUERY_TIMEOUT_MS = 10_000;

function assertPid(pid) {
  if (!Number.isInteger(pid) || pid < 1) throw new Error("PID must be a positive integer");
}

function normalizeExecutablePath(executablePath) {
  if (typeof executablePath !== "string" || !path.win32.isAbsolute(executablePath)) {
    throw new Error("process executable path must be absolute");
  }
  return path.win32.normalize(executablePath).toLowerCase();
}

export function processIdentityQueryPlan(pid) {
  assertPid(pid);
  const script = [
    `$process = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'`,
    "if ($null -eq $process) { exit 3 }",
    "$created = $process.CreationDate.ToUniversalTime().ToString('O')",
    "[pscustomobject]@{ pid = [int]$process.ProcessId; parentPid = [int]$process.ParentProcessId; creationTime = $created; executablePath = [string]$process.ExecutablePath } | ConvertTo-Json -Compress",
  ].join("; ");
  return {
    command: windowsPowerShell,
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    options: {
      encoding: "utf8",
      timeout: QUERY_TIMEOUT_MS,
      windowsHide: true,
    },
  };
}

export function processDetailsQueryPlan(pid) {
  assertPid(pid);
  const script = [
    `$process = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'`,
    "if ($null -eq $process) { exit 3 }",
    "$created = $process.CreationDate.ToUniversalTime().ToString('O')",
    "[pscustomobject]@{ pid = [int]$process.ProcessId; parentPid = [int]$process.ParentProcessId; creationTime = $created; executablePath = [string]$process.ExecutablePath; commandLine = [string]$process.CommandLine } | ConvertTo-Json -Compress",
  ].join("; ");
  return {
    command: windowsPowerShell,
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    options: {
      encoding: "utf8",
      timeout: QUERY_TIMEOUT_MS,
      windowsHide: true,
    },
  };
}

export function loopbackListenerQueryPlan(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("listener port must be an integer between 1 and 65535");
  }
  const script = [
    `$listeners = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | ForEach-Object { [int]$_.OwningProcess })`,
    "ConvertTo-Json -Compress -InputObject $listeners",
  ].join("; ");
  return {
    command: windowsPowerShell,
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    options: {
      encoding: "utf8",
      timeout: QUERY_TIMEOUT_MS,
      windowsHide: true,
    },
  };
}

export function processListQueryPlan(executableName) {
  if (
    typeof executableName !== "string" ||
    path.win32.basename(executableName) !== executableName ||
    !/^[a-zA-Z0-9._-]+$/.test(executableName)
  ) {
    throw new Error("process executable name is invalid");
  }
  const script = [
    `$processes = @(Get-CimInstance Win32_Process -Filter "Name = '${executableName}'" | ForEach-Object {`,
    "$created = $_.CreationDate.ToUniversalTime().ToString('O')",
    "[pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; creationTime = $created; executablePath = [string]$_.ExecutablePath }",
    "})",
    "ConvertTo-Json -Compress -InputObject $processes",
  ].join("; ");
  return {
    command: windowsPowerShell,
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    options: {
      encoding: "utf8",
      timeout: QUERY_TIMEOUT_MS,
      windowsHide: true,
    },
  };
}

export function processMemorySnapshotQueryPlan() {
  const script = [
    "$runtime = @{}",
    "@(Get-Process -ErrorAction SilentlyContinue) | ForEach-Object {",
    "try {",
    "$runtimeCreatedTicks = [long]$_.StartTime.ToUniversalTime().Ticks",
    "$runtimeCreatedMicrosecondTicks = $runtimeCreatedTicks - ($runtimeCreatedTicks % 10)",
    "$runtime[[int]$_.Id] = [pscustomobject]@{ creationTimeTicks = $runtimeCreatedMicrosecondTicks; workingSet64 = [long]$_.WorkingSet64; privateMemorySize64 = [long]$_.PrivateMemorySize64 }",
    "} catch {}",
    "}",
    "$processes = @(Get-CimInstance Win32_Process | ForEach-Object {",
    "$pidValue = [int]$_.ProcessId",
    "$live = $runtime[$pidValue]",
    "$created = if ($null -eq $_.CreationDate) { $null } else { $_.CreationDate.ToUniversalTime().ToString('O') }",
    "$createdTicks = if ($null -eq $_.CreationDate) { $null } else { [long]$_.CreationDate.ToUniversalTime().Ticks }",
    "$identityMatches = $null -ne $live -and $null -ne $createdTicks -and $live.creationTimeTicks -eq $createdTicks",
    "$workingSet = if ($identityMatches) { [long]$live.workingSet64 } else { $null }",
    "$privateMemory = if ($identityMatches) { [long]$live.privateMemorySize64 } else { $null }",
    "[pscustomobject]@{ pid = $pidValue; parentPid = [int]$_.ParentProcessId; creationTime = $created; executablePath = [string]$_.ExecutablePath; commandLine = [string]$_.CommandLine; workingSet64 = $workingSet; privateMemorySize64 = $privateMemory }",
    "})",
    "ConvertTo-Json -Compress -InputObject $processes",
  ].join("; ");
  return {
    command: windowsPowerShell,
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    options: {
      encoding: "utf8",
      timeout: QUERY_TIMEOUT_MS,
      windowsHide: true,
    },
  };
}

export function namedMutexQueryPlan(mutexName) {
  if (typeof mutexName !== "string" || !/^[a-zA-Z0-9.-]+-sim$/.test(mutexName)) {
    throw new Error("single-instance mutex name is invalid");
  }
  const script = [
    "try {",
    `$mutex = [System.Threading.Mutex]::OpenExisting('${mutexName}')`,
    "$mutex.Dispose()",
    "exit 0",
    "} catch [System.Threading.WaitHandleCannotBeOpenedException] { exit 3 }",
    "catch [System.UnauthorizedAccessException] { exit 0 }",
  ].join("; ");
  return {
    command: windowsPowerShell,
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    options: {
      encoding: "utf8",
      timeout: QUERY_TIMEOUT_MS,
      windowsHide: true,
    },
  };
}

export function roamingAppDataQueryPlan() {
  return {
    command: windowsPowerShell,
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)",
    ],
    options: {
      encoding: "utf8",
      timeout: QUERY_TIMEOUT_MS,
      windowsHide: true,
    },
  };
}

export function parseProcessIdentity(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Windows process query returned invalid JSON");
  }
  assertPid(parsed.pid);
  if (!Number.isInteger(parsed.parentPid) || parsed.parentPid < 0) {
    throw new Error("Windows process query returned an invalid parent PID");
  }
  if (typeof parsed.creationTime !== "string" || Number.isNaN(Date.parse(parsed.creationTime))) {
    throw new Error("Windows process query returned an invalid creation time");
  }
  return {
    pid: parsed.pid,
    parentPid: parsed.parentPid,
    creationTime: parsed.creationTime,
    executablePath: normalizeExecutablePath(parsed.executablePath),
  };
}

function parseOptionalMemoryBytes(value, label) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Windows process memory query returned invalid ${label}`);
  }
  return value;
}

export function parseProcessMemorySnapshot(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Windows process memory query returned invalid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Windows process memory query did not return an array");
  }
  return parsed.map((entry) => {
    if (!Number.isInteger(entry?.pid) || entry.pid < 0) {
      throw new Error("Windows process memory query returned an invalid PID");
    }
    if (!Number.isInteger(entry.parentPid) || entry.parentPid < 0) {
      throw new Error("Windows process memory query returned an invalid parent PID");
    }
    const creationTime =
      typeof entry.creationTime === "string" && !Number.isNaN(Date.parse(entry.creationTime))
        ? entry.creationTime
        : null;
    const executablePath =
      typeof entry.executablePath === "string" && path.win32.isAbsolute(entry.executablePath)
        ? normalizeExecutablePath(entry.executablePath)
        : null;
    const commandLine =
      typeof entry.commandLine === "string" && entry.commandLine.length > 0
        ? entry.commandLine
        : null;
    return {
      pid: entry.pid,
      parentPid: entry.parentPid,
      creationTime,
      executablePath,
      commandLine,
      workingSet64: parseOptionalMemoryBytes(entry.workingSet64, "WorkingSet64"),
      privateMemorySize64: parseOptionalMemoryBytes(
        entry.privateMemorySize64,
        "PrivateMemorySize64"
      ),
    };
  });
}

export function queryProcessIdentity(pid, execute = spawnSync) {
  const plan = processIdentityQueryPlan(pid);
  const result = execute(plan.command, plan.args, plan.options);
  if (result.error) throw result.error;
  if (result.status === 3) return null;
  if (result.status !== 0) {
    throw new Error(`Windows process query failed with exit code ${result.status}`);
  }
  return parseProcessIdentity(result.stdout);
}

export function queryProcessDetails(pid, execute = spawnSync) {
  const plan = processDetailsQueryPlan(pid);
  const result = execute(plan.command, plan.args, plan.options);
  if (result.error) throw result.error;
  if (result.status === 3) return null;
  if (result.status !== 0) {
    throw new Error(`Windows process details query failed with exit code ${result.status}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("Windows process details query returned invalid JSON");
  }
  const identity = parseProcessIdentity(JSON.stringify(parsed));
  if (typeof parsed.commandLine !== "string" || parsed.commandLine.length === 0) {
    throw new Error("Windows process details query returned an invalid command line");
  }
  return { ...identity, commandLine: parsed.commandLine };
}

export function queryLoopbackListenerOwner(port, execute = spawnSync) {
  const plan = loopbackListenerQueryPlan(port);
  const result = execute(plan.command, plan.args, plan.options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`loopback listener query failed with exit code ${result.status}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("loopback listener query returned invalid JSON");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 1 ||
    !Number.isInteger(parsed[0]) ||
    parsed[0] < 1
  ) {
    throw new Error("CDP loopback listener does not have one unambiguous owner");
  }
  return parsed[0];
}

export function assertOwnedCdpProcess({ appIdentity, listenerProcess, profileDir, port }) {
  if (!appIdentity || !listenerProcess) throw new Error("CDP ownership identity is missing");
  if (listenerProcess.parentPid !== appIdentity.pid) {
    throw new Error("CDP listener is not a direct child of the performance app");
  }
  if (path.win32.basename(listenerProcess.executablePath) !== "msedgewebview2.exe") {
    throw new Error("CDP listener is not a WebView2 process");
  }
  const commandLine = listenerProcess.commandLine.toLowerCase();
  if (!commandLine.includes(`--remote-debugging-port=${port}`)) {
    throw new Error("CDP listener command line does not contain the dedicated port");
  }
  if (!commandLine.includes(path.win32.normalize(profileDir).toLowerCase())) {
    throw new Error("CDP listener command line does not contain the dedicated profile");
  }
  return listenerProcess;
}

export function listProcessIdentities(executableName, execute = spawnSync) {
  const plan = processListQueryPlan(executableName);
  const result = execute(plan.command, plan.args, plan.options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Windows process list query failed with exit code ${result.status}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("Windows process list query returned invalid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("Windows process list query did not return an array");
  return parsed.map((entry) => parseProcessIdentity(JSON.stringify(entry)));
}

export function queryProcessMemorySnapshot(execute = spawnSync) {
  const plan = processMemorySnapshotQueryPlan();
  const result = execute(plan.command, plan.args, plan.options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Windows process memory query failed with exit code ${result.status}`);
  }
  return parseProcessMemorySnapshot(result.stdout);
}

export function namedMutexExists(mutexName, execute = spawnSync) {
  const plan = namedMutexQueryPlan(mutexName);
  const result = execute(plan.command, plan.args, plan.options);
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 3) return false;
  throw new Error(`single-instance mutex query failed with exit code ${result.status}`);
}

export function queryRoamingAppData(execute = spawnSync) {
  const plan = roamingAppDataQueryPlan();
  const result = execute(plan.command, plan.args, plan.options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Roaming AppData query failed with exit code ${result.status}`);
  }
  const directory = result.stdout.trim();
  if (!path.win32.isAbsolute(directory)) {
    throw new Error("Roaming AppData query did not return an absolute path");
  }
  return path.win32.normalize(directory);
}
