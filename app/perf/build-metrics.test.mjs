import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PERF_MANIFEST_PATH,
  assertProductionOutputClean,
  buildMetricsMarkdown,
  collectBuildMetrics,
} from "./build-metrics.mjs";

function createBuild(manifest) {
  const root = mkdtempSync(path.join(os.tmpdir(), "feathermd-perf-test-"));
  mkdirSync(path.join(root, "assets"), { recursive: true });
  mkdirSync(path.join(root, ".vite"), { recursive: true });
  writeFileSync(
    path.join(root, "index.html"),
    '<link href="/assets/entry.js" rel="modulepreload"><link href="/assets/app.css" rel="stylesheet">'
  );
  writeFileSync(path.join(root, "assets", "entry.js"), "import './shared.js';");
  writeFileSync(path.join(root, "assets", "shared.js"), "export const shared = true;");
  writeFileSync(path.join(root, "assets", "lazy.js"), "export const mermaid = true;");
  writeFileSync(path.join(root, "assets", "app.css"), "body { color: black; }");
  writeFileSync(path.join(root, "assets", "lazy.css"), ".mermaid { display: block; }");
  writeFileSync(
    path.join(root, ...PERF_MANIFEST_PATH.split("/")),
    JSON.stringify(manifest ?? validManifest())
  );
  return root;
}

function validManifest() {
  return {
    "src/main.js": {
      file: "assets/entry.js",
      isEntry: true,
      imports: ["_shared.js"],
      dynamicImports: ["node_modules/mermaid/index.js"],
      css: ["assets/app.css"],
    },
    "_shared.js": { file: "assets/shared.js" },
    "node_modules/mermaid/index.js": {
      file: "assets/lazy.js",
      isDynamicEntry: true,
      css: ["assets/lazy.css"],
    },
  };
}

test("classifies initial, lazy, feature, type, and distribution sizes", (context) => {
  const root = createBuild();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const metrics = collectBuildMetrics({
    buildDir: root,
    distributionPaths: { executable: path.join(root, "assets", "entry.js") },
  });
  assert.equal(metrics.initial.fileCount, 3);
  assert.equal(metrics.lazy.fileCount, 2);
  assert.equal(metrics.featureGroups.mermaid.fileCount, 2);
  assert.equal(metrics.featureGroups.katex.fileCount, 0);
  assert.equal(metrics.distributions.executable.status, "measured");
  assert.equal(metrics.distributions.msi.status, "not-measured");
  assert.ok(metrics.total.rawBytes > metrics.initial.rawBytes);
  assert.ok(metrics.byType.javascript.rawBytes > 0);
  assert.match(
    buildMetricsMarkdown({
      source: { commit: "abc", appVersion: "1.0.0" },
      schemaVersion: 1,
      fixtureVersion: "fixture",
      build: metrics,
    }),
    /Mode: report only/
  );
});

test("uses final HTML references instead of every manifest entry for the initial graph", (context) => {
  const manifest = validManifest();
  manifest["unused-route.js"] = { file: "assets/unused-route.js", isEntry: true };
  const root = createBuild(manifest);
  writeFileSync(path.join(root, "assets", "unused-route.js"), "export const unused = true;");
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const metrics = collectBuildMetrics({ buildDir: root });
  assert.equal(metrics.initial.fileCount, 3);
  assert.equal(metrics.lazy.fileCount, 3);
});

test("fails closed for missing dependencies, duplicate outputs, and traversal", (context) => {
  const missingDependency = validManifest();
  missingDependency["src/main.js"].imports = ["missing.js"];
  const missingRoot = createBuild(missingDependency);
  context.after(() => rmSync(missingRoot, { recursive: true, force: true }));
  assert.throws(() => collectBuildMetrics({ buildDir: missingRoot }), /dependency is missing/);

  const duplicate = validManifest();
  duplicate["duplicate.js"] = { file: "assets/shared.js" };
  const duplicateRoot = createBuild(duplicate);
  context.after(() => rmSync(duplicateRoot, { recursive: true, force: true }));
  assert.throws(() => collectBuildMetrics({ buildDir: duplicateRoot }), /duplicate owners/);

  const traversal = validManifest();
  traversal["src/main.js"].file = "../outside.js";
  const traversalRoot = createBuild(traversal);
  context.after(() => rmSync(traversalRoot, { recursive: true, force: true }));
  assert.throws(() => collectBuildMetrics({ buildDir: traversalRoot }), /escapes build output/);
});

test("fails closed for missing manifests and missing outputs", (context) => {
  const missingManifestRoot = createBuild();
  context.after(() => rmSync(missingManifestRoot, { recursive: true, force: true }));
  rmSync(path.join(missingManifestRoot, ...PERF_MANIFEST_PATH.split("/")));
  assert.throws(() => collectBuildMetrics({ buildDir: missingManifestRoot }), /ENOENT/);

  const missingOutput = validManifest();
  missingOutput["node_modules/mermaid/index.js"].file = "assets/missing.js";
  const missingOutputRoot = createBuild(missingOutput);
  context.after(() => rmSync(missingOutputRoot, { recursive: true, force: true }));
  assert.throws(() => collectBuildMetrics({ buildDir: missingOutputRoot }), /output is missing/);
});

test("rejects performance manifests and fixture markers in production output", (context) => {
  const root = createBuild();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => assertProductionOutputClean(root), /manifest leaked/);
  rmSync(path.join(root, ...PERF_MANIFEST_PATH.split("/")));
  writeFileSync(path.join(root, "assets", "entry.js"), "const marker = 'perf-plain-marker-v1';");
  assert.throws(() => assertProductionOutputClean(root), /fixture leaked/);
  writeFileSync(path.join(root, "assets", "entry.js"), "export const clean = true;");
  assert.doesNotThrow(() => assertProductionOutputClean(root));
});
