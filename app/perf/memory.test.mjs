import assert from "node:assert/strict";
import test from "node:test";
import { collectStableProcessTreeMemory } from "./memory.mjs";

const app = {
  pid: 100,
  parentPid: 1,
  creationTime: "2026-08-01T00:00:00.000Z",
  executablePath: "c:\\build\\feathermd.exe",
  commandLine: "feathermd.exe",
  workingSet64: 1000,
  privateMemorySize64: 800,
};
const webview = {
  pid: 200,
  parentPid: 100,
  creationTime: "2026-08-01T00:00:01.000Z",
  executablePath: "c:\\program files\\webview2\\msedgewebview2.exe",
  commandLine: "msedgewebview2.exe --user-data-dir=c:\\temp\\owned-profile",
  workingSet64: 2000,
  privateMemorySize64: 1500,
};
const renderer = {
  pid: 300,
  parentPid: 200,
  creationTime: "2026-08-01T00:00:02.000Z",
  executablePath: "c:\\program files\\webview2\\msedgewebview2.exe",
  commandLine: "msedgewebview2.exe --user-data-dir=c:\\temp\\owned-profile --type=renderer",
  workingSet64: 3000,
  privateMemorySize64: 2500,
};
const unrelated = {
  pid: 400,
  parentPid: 1,
  creationTime: "2026-08-01T00:00:03.000Z",
  executablePath: "c:\\windows\\system32\\other.exe",
  commandLine: "other.exe",
  workingSet64: 9000,
  privateMemorySize64: 9000,
};

function identity(process) {
  return {
    pid: process.pid,
    parentPid: process.parentPid,
    creationTime: process.creationTime,
    executablePath: process.executablePath,
  };
}

async function collect(snapshots, options = {}) {
  let index = 0;
  return collectStableProcessTreeMemory({
    scenario: options.scenario ?? "plain",
    rootIdentity: identity(app),
    requiredIdentities: [identity(webview)],
    querySnapshot: () => snapshots[index++],
    wait: async () => {},
  });
}

test("aggregates the stable Tauri and WebView2 descendant tree", async () => {
  const first = [unrelated, renderer, app, webview];
  const second = [
    unrelated,
    { ...renderer, workingSet64: 3200 },
    { ...app, workingSet64: 1100 },
    { ...webview, privateMemorySize64: 1600 },
  ];
  assert.deepEqual(await collect([first, second]), {
    scenario: "plain",
    status: "measured",
    processCount: 3,
    workingSetBytes: 6300,
    privateMemoryBytes: 4900,
    processes: [
      {
        pid: 100,
        parentPid: 1,
        name: "feathermd.exe",
        workingSet64: 1100,
        privateMemorySize64: 800,
      },
      {
        pid: 200,
        parentPid: 100,
        name: "msedgewebview2.exe",
        workingSet64: 2000,
        privateMemorySize64: 1600,
      },
      {
        pid: 300,
        parentPid: 200,
        name: "msedgewebview2.exe",
        workingSet64: 3200,
        privateMemorySize64: 2500,
      },
    ],
  });
});

test("deduplicates traversal and rejects duplicate process records", async () => {
  const cycle = { ...app, parentPid: renderer.pid };
  const measured = await collect([
    [cycle, webview, renderer],
    [cycle, webview, renderer],
  ]);
  assert.equal(measured.processCount, 3);

  const duplicate = await collect([
    [app, app, webview],
    [app, webview],
  ]);
  assert.deepEqual(duplicate, {
    scenario: "plain",
    status: "not-measured",
    reason: "duplicate-process-id",
  });
});

test("fails closed for disappeared, replaced, or partial process data", async () => {
  const cases = [
    {
      expected: "required-process-missing",
      snapshots: [[app, webview], [app]],
    },
    {
      expected: "root-process-replaced",
      snapshots: [
        [{ ...app, creationTime: "2026-08-01T00:10:00.000Z" }, webview],
        [app, webview],
      ],
    },
    {
      expected: "partial-process-data",
      snapshots: [
        [app, { ...webview, workingSet64: null }],
        [app, webview],
      ],
    },
  ];
  for (const { expected, snapshots } of cases) {
    assert.equal((await collect(snapshots)).reason, expected);
  }
});

test("rejects a changing process topology instead of reporting a partial total", async () => {
  const result = await collect([
    [app, webview],
    [app, webview, renderer],
  ]);
  assert.deepEqual(result, {
    scenario: "plain",
    status: "not-measured",
    reason: "unstable-process-tree",
  });
});

test("rejects an owned-profile WebView2 process outside the Tauri tree", async () => {
  const movedRenderer = { ...renderer, parentPid: unrelated.pid };
  let index = 0;
  const snapshots = [
    [app, webview, movedRenderer, unrelated],
    [app, webview, movedRenderer, unrelated],
  ];
  const result = await collectStableProcessTreeMemory({
    scenario: "rich",
    rootIdentity: identity(app),
    requiredIdentities: [identity(webview)],
    ownedProfileDir: "C:\\temp\\owned-profile",
    querySnapshot: () => snapshots[index++],
    wait: async () => {},
  });
  assert.deepEqual(result, {
    scenario: "rich",
    status: "not-measured",
    reason: "owned-webview-outside-tree",
  });
});

test("converts snapshot query failures into a stable public reason", async () => {
  const result = await collectStableProcessTreeMemory({
    scenario: "empty",
    rootIdentity: identity(app),
    querySnapshot: () => {
      throw new Error("contains a private local path");
    },
    wait: async () => {},
  });
  assert.deepEqual(result, {
    scenario: "empty",
    status: "not-measured",
    reason: "process-snapshot-failed",
  });
});
