import assert from "node:assert/strict";
import test from "node:test";
import {
  fixtureCompletionExpression,
  startFixtureReplacementObservation,
  waitForFixtureReplacement,
} from "./fixture-render.mjs";
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

test("does not accept an active-tab change while the first render DOM remains", async () => {
  const [fixture] = validatePerformanceFixtures();
  let firstRenderRemoved = false;
  let observationInstalled = false;
  const driver = {
    evaluate: async (expression) => {
      if (expression.includes("new MutationObserver")) observationInstalled = true;
      if (expression.includes("delete globalThis")) observationInstalled = false;
      return true;
    },
    waitFor: async (expression) => {
      assert.equal(observationInstalled, true);
      assert.match(expression, /state\.removed/);
      if (!firstRenderRemoved) throw new Error("first render DOM is still present");
    },
  };

  await startFixtureReplacementObservation(driver, fixture);
  await assert.rejects(waitForFixtureReplacement(driver), /first render DOM is still present/);

  firstRenderRemoved = true;
  await startFixtureReplacementObservation(driver, fixture);
  await waitForFixtureReplacement(driver);
});
