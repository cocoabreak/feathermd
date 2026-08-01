import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertMaterializedPerformanceFixture,
  assertValidatedPerformanceFixture,
  materializePerformanceFixture,
  PERFORMANCE_FIXTURES,
  validatePerformanceFixtures,
} from "./fixtures.mjs";
import { createPerformanceWorkspace } from "./run-workspace.mjs";
import { preparePerformanceLaunch } from "./runner.mjs";

function workspaceFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "feathermd-fixture-copy-test-"));
  const roaming = path.join(root, "roaming");
  const temp = path.join(root, "temp");
  mkdirSync(roaming);
  mkdirSync(temp);
  const plan = preparePerformanceLaunch(
    {
      port: 41_238,
      runDir: path.join(temp, "ignored"),
      executablePath: "C:\\build\\feathermd.exe",
      environment: {},
      platform: "win32",
    },
    {
      listProcesses: () => [],
      mutexExists: () => false,
      getRoamingAppData: () => roaming,
    }
  );
  return { root, workspace: createPerformanceWorkspace(plan, { tempRoot: temp }) };
}

test("fixtures keep their IDs, bytes, hashes, and renderer markers", () => {
  const fixtures = validatePerformanceFixtures();
  assert.deepEqual(
    fixtures.map(({ id, byteSize, sha256 }) => ({ id, byteSize, sha256 })),
    PERFORMANCE_FIXTURES.map(({ id, byteSize, sha256 }) => ({ id, byteSize, sha256 }))
  );
  for (const fixture of fixtures) {
    assert.equal(readFileSync(fixture.path).length, fixture.byteSize);
  }
});

test("only validated fixture objects can cross the runner boundary", () => {
  const [fixture] = validatePerformanceFixtures();
  assert.equal(assertValidatedPerformanceFixture(fixture), fixture);
  assert.throws(() => assertValidatedPerformanceFixture({ ...fixture }), /validation/);
  assert.equal(Object.isFrozen(fixture), true);
  assert.equal(Object.isFrozen(fixture.markers), true);
});

test("materialized fixtures are bound to an owned immutable copy", () => {
  const { root, workspace } = workspaceFixture();
  try {
    const [source] = validatePerformanceFixtures();
    const fixture = materializePerformanceFixture(workspace, source);
    const repeat = materializePerformanceFixture(workspace, source, { variant: "repeat" });
    assert.equal(assertMaterializedPerformanceFixture(fixture), fixture);
    assert.equal(existsSync(fixture.path), true);
    assert.equal(Object.isFrozen(fixture), true);
    assert.notEqual(fixture.path, repeat.path);
    assert.deepEqual(readFileSync(fixture.path), readFileSync(repeat.path));
    assert.throws(
      () => materializePerformanceFixture(workspace, source, { variant: "invalid" }),
      /variant/
    );

    const moved = `${fixture.path}.moved`;
    renameSync(fixture.path, moved);
    writeFileSync(fixture.path, "unvalidated replacement");
    assert.throws(() => assertMaterializedPerformanceFixture(fixture), /content changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
