import { assertValidatedPerformanceFixture } from "./fixtures.mjs";

const COMPLETION_EXPRESSIONS = {
  "plain-v1": `(() => {
    const viewer = document.querySelector(".markdown-body");
    if (!viewer || !viewer.textContent.includes("perf-plain-marker-v1")) return false;
    return viewer.querySelector("table") !== null &&
      viewer.querySelector("blockquote") !== null &&
      Array.from(viewer.querySelectorAll("a")).some((link) =>
        link.textContent.includes("Local reference"));
  })()`,
  "rich-v1": `(() => {
    const viewer = document.querySelector(".markdown-body");
    if (!viewer || !viewer.textContent.includes("perf-rich-marker-v1")) return false;
    const highlighted = Array.from(viewer.querySelectorAll("pre.shiki"));
    const hasJavaScript = highlighted.some((block) =>
      block.textContent.includes("perf-shiki-javascript-marker-v1"));
    const hasRust = highlighted.some((block) =>
      block.textContent.includes("perf-shiki-rust-marker-v1"));
    const katex = viewer.querySelector(".katex");
    const mermaid = viewer.querySelector(".mermaid-rendered svg");
    return hasJavaScript && hasRust &&
      katex?.textContent.includes("perf-katex-marker-v1") === true &&
      mermaid?.textContent.includes("perf-mermaid-marker-v1") === true &&
      viewer.querySelector(".mermaid-pending") === null;
  })()`,
};

export function fixtureCompletionExpression(fixture) {
  assertValidatedPerformanceFixture(fixture);
  const expression = COMPLETION_EXPRESSIONS[fixture.id];
  if (!expression) throw new Error(`unsupported performance fixture: ${fixture.id}`);
  return expression;
}

export async function waitForPerformanceFixture(driver, fixture, { timeoutMs = 30_000 } = {}) {
  const completionExpression = fixtureCompletionExpression(fixture);
  try {
    if (fixture.id === "rich-v1") {
      await driver.waitFor(
        `document.querySelector(".markdown-body")?.textContent.includes(${JSON.stringify(fixture.markers[0])}) === true`,
        { timeoutMs }
      );
      await driver.evaluate(`(() => {
        const pending = document.querySelector(".markdown-body .mermaid-pending");
        pending?.scrollIntoView({ block: "center" });
        return pending !== null;
      })()`);
    }
    await driver.waitFor(completionExpression, { timeoutMs });
  } catch (error) {
    const state = await driver.evaluate(`(() => {
      const viewer = document.querySelector(".markdown-body");
      return {
        viewerPresent: viewer !== null,
        fixtureMarkerPresent: viewer?.textContent.includes(${JSON.stringify(fixture.markers[0])}) === true,
        shikiCount: viewer?.querySelectorAll("pre.shiki").length ?? 0,
        katexCount: viewer?.querySelectorAll(".katex").length ?? 0,
        katexMarkerPresent: Array.from(viewer?.querySelectorAll(".katex") ?? [])
          .some((node) => node.textContent.includes("perf-katex-marker-v1")),
        mermaidCount: viewer?.querySelectorAll(".mermaid-rendered svg").length ?? 0,
        mermaidMarkerPresent: Array.from(viewer?.querySelectorAll(".mermaid-rendered svg") ?? [])
          .some((node) => node.textContent.includes("perf-mermaid-marker-v1")),
        mermaidPending: viewer?.querySelectorAll(".mermaid-pending").length ?? 0
      };
    })()`);
    throw new Error(`performance fixture render timed out: ${JSON.stringify(state)}`, {
      cause: error,
    });
  }
}
