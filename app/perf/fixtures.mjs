import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertOwnedPerformanceWorkspace } from "./run-workspace.mjs";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const validatedFixtures = new WeakMap();
const materializedFixtures = new WeakMap();

function immutableFixture(fixture, path) {
  return Object.freeze({ ...fixture, markers: Object.freeze([...fixture.markers]), path });
}

function normalize(file) {
  return path.win32.normalize(file).toLowerCase();
}

function realFile(file, label) {
  if (!path.win32.isAbsolute(file)) throw new Error(`${label} must be absolute`);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a real file`);
  const resolved = path.win32.normalize(realpathSync.native(file));
  if (normalize(resolved) !== normalize(file)) throw new Error(`${label} path changed`);
  return {
    path: resolved,
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
  };
}

function readVerifiedBytes(file, expected, label) {
  const identity = realFile(file, label);
  const descriptor = openSync(identity.path, "r");
  try {
    const opened = fstatSync(descriptor);
    if (
      opened.dev !== identity.dev ||
      opened.ino !== identity.ino ||
      opened.birthtimeMs !== identity.birthtimeMs
    ) {
      throw new Error(`${label} ownership changed while opening`);
    }
    const bytes = readFileSync(descriptor);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== expected.byteSize || sha256 !== expected.sha256) {
      throw new Error(`${label} content changed`);
    }
    return { bytes, identity };
  } finally {
    closeSync(descriptor);
  }
}

export const PERFORMANCE_FIXTURES = [
  {
    id: "plain-v1",
    fileName: "plain-v1.md",
    byteSize: 574,
    sha256: "4b59e9d56849cf37a870fe68230bcd01fa9597c9ffb59edc5d2276a8179c672a",
    markers: ["perf-plain-marker-v1"],
  },
  {
    id: "rich-v1",
    fileName: "rich-v1.md",
    byteSize: 557,
    sha256: "a6d74cef1fc8d740502edcb1c1f5dc4fc3949097efe97ad6cf1bfadebabe435c",
    markers: [
      "perf-rich-marker-v1",
      "perf-shiki-javascript-marker-v1",
      "perf-shiki-rust-marker-v1",
      "perf-katex-marker-v1",
      "perf-mermaid-marker-v1",
    ],
  },
];

export function validatePerformanceFixtures() {
  return PERFORMANCE_FIXTURES.map((fixture) => {
    const sourcePath = path.join(fixtureDir, fixture.fileName);
    const { bytes, identity } = readVerifiedBytes(sourcePath, fixture, fixture.id);
    const text = bytes.toString("utf8");
    if (bytes.includes(0x0d)) throw new Error(`${fixture.id} must use LF line endings`);
    for (const marker of fixture.markers) {
      if (!text.includes(marker)) throw new Error(`${fixture.id} is missing marker ${marker}`);
    }
    if (/https?:\/\//i.test(text)) throw new Error(`${fixture.id} must not use remote resources`);
    const validated = immutableFixture(fixture, identity.path);
    validatedFixtures.set(validated, Object.freeze(identity));
    return validated;
  });
}

export function assertValidatedPerformanceFixture(fixture) {
  if (!validatedFixtures.has(fixture)) {
    throw new Error("performance fixture has not passed validation");
  }
  return fixture;
}

export function materializePerformanceFixture(workspace, fixture, { variant = "first" } = {}) {
  assertOwnedPerformanceWorkspace(workspace);
  assertValidatedPerformanceFixture(fixture);
  if (variant !== "first" && variant !== "repeat") {
    throw new Error("performance fixture variant is invalid");
  }
  const source = readVerifiedBytes(fixture.path, fixture, fixture.id);
  const expectedSource = validatedFixtures.get(fixture);
  if (
    source.identity.dev !== expectedSource.dev ||
    source.identity.ino !== expectedSource.ino ||
    source.identity.birthtimeMs !== expectedSource.birthtimeMs
  ) {
    throw new Error("performance fixture source ownership changed");
  }

  const outputName = `${fixture.id}-${variant}.md`;
  const output = path.win32.join(workspace.runDir, outputName);
  writeFileSync(output, source.bytes, { flag: "wx" });
  const copied = readVerifiedBytes(output, fixture, `${fixture.id} materialized copy`);
  const materialized = immutableFixture({ ...fixture, fileName: outputName }, copied.identity.path);
  validatedFixtures.set(materialized, Object.freeze(copied.identity));
  materializedFixtures.set(materialized, Object.freeze(copied.identity));
  return materialized;
}

export function assertMaterializedPerformanceFixture(fixture) {
  if (!materializedFixtures.has(fixture)) {
    throw new Error("performance fixture has not been materialized");
  }
  const current = readVerifiedBytes(fixture.path, fixture, `${fixture.id} materialized copy`);
  const expected = materializedFixtures.get(fixture);
  if (
    current.identity.dev !== expected.dev ||
    current.identity.ino !== expected.ino ||
    current.identity.birthtimeMs !== expected.birthtimeMs
  ) {
    throw new Error("materialized performance fixture ownership changed");
  }
  return fixture;
}
