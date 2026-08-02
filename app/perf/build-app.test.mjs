import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  appDir,
  assertExecutableContainsIdentifier,
  performanceBuildPlan,
  performanceConfigPath,
  performanceTargetDir,
  validatePerformanceOverlay,
} from "./build-app.mjs";

test("requires the dedicated identifier in the built executable", () => {
  assert.doesNotThrow(() =>
    assertExecutableContainsIdentifier(
      Buffer.from("prefix com.cocoabreak.feathermd.performance suffix"),
      "com.cocoabreak.feathermd.performance"
    )
  );
  assert.throws(
    () =>
      assertExecutableContainsIdentifier(
        Buffer.from("com.cocoabreak.feathermd"),
        "com.cocoabreak.feathermd.performance"
      ),
    /does not contain/
  );
});

test("performance overlay changes only the app identity", () => {
  const { base, overlay } = validatePerformanceOverlay();
  assert.deepEqual(Object.keys(overlay).sort(), ["$schema", "identifier", "productName"]);
  assert.notEqual(overlay.identifier, base.identifier);
  assert.notEqual(overlay.productName, base.productName);
  assert.equal(path.dirname(performanceConfigPath), path.join(appDir, "src-tauri"));
});

test("performance build uses an isolated release target and production single-instance", () => {
  const plan = performanceBuildPlan({
    npm_execpath: "npm-cli.js",
    FEATHERMD_E2E_DISABLE_SINGLE_INSTANCE: "1",
    FEATHERMD_E2E_STATE_DIR: "test-state",
  });
  assert.equal(plan.options.env.CARGO_TARGET_DIR, performanceTargetDir);
  assert.equal(plan.options.env.FEATHERMD_E2E_DISABLE_SINGLE_INSTANCE, undefined);
  assert.equal(plan.options.env.FEATHERMD_E2E_STATE_DIR, undefined);
  assert.deepEqual(plan.args.slice(-3), ["--config", performanceConfigPath, "--no-bundle"]);
  assert.equal(plan.args.includes("--debug"), false);
});
