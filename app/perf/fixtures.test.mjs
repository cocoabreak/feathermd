import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PERFORMANCE_FIXTURES, validatePerformanceFixtures } from "./fixtures.mjs";

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
