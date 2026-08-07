import path from "node:path";
import { queryProcessMemorySnapshot } from "./windows-process.mjs";

export const MEMORY_STABILITY_INTERVAL_MS = 250;
const MEMORY_SCENARIOS = new Set(["empty", "plain", "rich"]);

function notMeasured(scenario, reason) {
  return { scenario, status: "not-measured", reason };
}

function identityMatches(process, identity) {
  return (
    process?.pid === identity?.pid &&
    process.creationTime === identity.creationTime &&
    process.executablePath === identity.executablePath
  );
}

function selectProcessTree(snapshot, rootIdentity, requiredIdentities, ownedProfileDir) {
  if (!Array.isArray(snapshot)) return { error: "invalid-process-snapshot" };
  const byPid = new Map();
  const children = new Map();
  for (const process of snapshot) {
    if (byPid.has(process.pid)) return { error: "duplicate-process-id" };
    byPid.set(process.pid, process);
    const siblings = children.get(process.parentPid) ?? [];
    siblings.push(process.pid);
    children.set(process.parentPid, siblings);
  }

  const root = byPid.get(rootIdentity.pid);
  if (!root) return { error: "root-process-missing" };
  if (!identityMatches(root, rootIdentity)) return { error: "root-process-replaced" };

  const selectedPids = new Set();
  const pending = [root.pid];
  while (pending.length > 0) {
    const pid = pending.shift();
    if (selectedPids.has(pid)) continue;
    selectedPids.add(pid);
    for (const childPid of children.get(pid) ?? []) pending.push(childPid);
  }

  for (const identity of requiredIdentities) {
    const process = byPid.get(identity.pid);
    if (!process || !selectedPids.has(identity.pid)) {
      return { error: "required-process-missing" };
    }
    if (!identityMatches(process, identity)) return { error: "required-process-replaced" };
  }

  if (ownedProfileDir) {
    const normalizedProfile = path.win32.normalize(ownedProfileDir).toLowerCase();
    const ownedWebViews = snapshot.filter(
      (process) =>
        process.executablePath &&
        path.win32.basename(process.executablePath) === "msedgewebview2.exe" &&
        process.commandLine?.toLowerCase().includes(normalizedProfile)
    );
    if (ownedWebViews.length === 0) return { error: "owned-webview-process-missing" };
    if (ownedWebViews.some((process) => !selectedPids.has(process.pid))) {
      return { error: "owned-webview-outside-tree" };
    }
  }

  const processes = [...selectedPids]
    .map((pid) => byPid.get(pid))
    .sort((left, right) => left.pid - right.pid);
  if (
    processes.some(
      (process) =>
        !process.creationTime ||
        !process.executablePath ||
        !Number.isSafeInteger(process.workingSet64) ||
        !Number.isSafeInteger(process.privateMemorySize64)
    )
  ) {
    return { error: "partial-process-data" };
  }

  return { processes };
}

function topologyKey(processes) {
  return processes
    .map(
      (process) =>
        `${process.pid}:${process.parentPid}:${process.creationTime}:${process.executablePath}`
    )
    .join("\n");
}

function measuredMetric(scenario, processes) {
  let workingSetBytes = 0;
  let privateMemoryBytes = 0;
  const publicProcesses = processes.map((process) => {
    workingSetBytes += process.workingSet64;
    privateMemoryBytes += process.privateMemorySize64;
    return {
      pid: process.pid,
      parentPid: process.parentPid,
      name: path.win32.basename(process.executablePath).toLowerCase(),
      workingSet64: process.workingSet64,
      privateMemorySize64: process.privateMemorySize64,
    };
  });
  if (!Number.isSafeInteger(workingSetBytes) || !Number.isSafeInteger(privateMemoryBytes)) {
    return notMeasured(scenario, "memory-total-overflow");
  }
  return {
    scenario,
    status: "measured",
    processCount: publicProcesses.length,
    workingSetBytes,
    privateMemoryBytes,
    processes: publicProcesses,
  };
}

export async function collectStableProcessTreeMemory({
  scenario,
  rootIdentity,
  requiredIdentities = [],
  ownedProfileDir,
  querySnapshot = queryProcessMemorySnapshot,
  wait = (milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)),
  stabilityIntervalMs = MEMORY_STABILITY_INTERVAL_MS,
} = {}) {
  if (!MEMORY_SCENARIOS.has(scenario)) throw new Error("memory scenario is invalid");
  if (!rootIdentity) throw new Error("memory root identity is required");
  if (!Array.isArray(requiredIdentities))
    throw new Error("required process identities are invalid");
  if (ownedProfileDir !== undefined && !path.win32.isAbsolute(ownedProfileDir)) {
    throw new Error("owned WebView profile must be an absolute Windows path");
  }
  if (!Number.isFinite(stabilityIntervalMs) || stabilityIntervalMs < 0) {
    throw new Error("memory stability interval is invalid");
  }

  let firstSnapshot;
  let secondSnapshot;
  try {
    firstSnapshot = querySnapshot();
    const firstTree = selectProcessTree(
      firstSnapshot,
      rootIdentity,
      requiredIdentities,
      ownedProfileDir
    );
    if (firstTree.error) return notMeasured(scenario, firstTree.error);
    await wait(stabilityIntervalMs);
    secondSnapshot = querySnapshot();
    const secondTree = selectProcessTree(
      secondSnapshot,
      rootIdentity,
      requiredIdentities,
      ownedProfileDir
    );
    if (secondTree.error) return notMeasured(scenario, secondTree.error);
    if (topologyKey(firstTree.processes) !== topologyKey(secondTree.processes)) {
      return notMeasured(scenario, "unstable-process-tree");
    }
    return measuredMetric(scenario, secondTree.processes);
  } catch {
    return notMeasured(scenario, "process-snapshot-failed");
  }
}
