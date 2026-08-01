import assert from "node:assert/strict";
import test from "node:test";
import { fixtureCompletionExpression } from "./fixture-render.mjs";
import { validatePerformanceFixtures } from "./fixtures.mjs";

test("defines production DOM completion checks for every fixed fixture", () => {
  for (const fixture of validatePerformanceFixtures()) {
    const expression = fixtureCompletionExpression(fixture);
    for (const marker of fixture.markers) assert.match(expression, new RegExp(marker));
    assert.match(expression, /\.markdown-body/);
  }
});

test("rejects an unvalidated fixture completion request", () => {
  const [fixture] = validatePerformanceFixtures();
  assert.throws(() => fixtureCompletionExpression({ ...fixture }), /validation/);
});
