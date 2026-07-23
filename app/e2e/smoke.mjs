import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WebView2Driver,
  findFreePort,
  launchTauriDev,
  terminateProcessTree,
} from "../scripts/webview2-driver.mjs";
import { createFixtures } from "./fixtures.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(appDir, "e2e", "artifacts");
const workDir = mkdtempSync(path.join(os.tmpdir(), "feathermd-e2e-"));
const fixtures = createFixtures(path.join(workDir, "fixtures"));
const port = await findFreePort();
const driver = new WebView2Driver({ port });
let child;
let failed = false;
let diagnostics;

const js = (value) => JSON.stringify(value.replaceAll("\\", "/"));
const state = () => driver.evaluate("window.__e2e.getState()");

async function test(name, run) {
  try {
    await run();
    globalThis.console.log(`PASS ${name}`);
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : error}`, { cause: error });
  }
}

async function open(method, file) {
  await driver.evaluate(`window.__e2e.${method}(${js(file)})`);
}

try {
  mkdirSync(artifactsDir, { recursive: true });
  const stateDir = path.join(workDir, "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, "settings.json"),
    JSON.stringify({ settings: { checkForUpdatesOnStartup: false } })
  );
  child = launchTauriDev({
    appDir,
    port,
    profileDir: path.join(workDir, "profile"),
    stateDir,
    logPath: path.join(artifactsDir, "tauri.log"),
  });
  await driver.waitForCdp();
  diagnostics = await driver.observeDiagnostics();
  await driver.waitFor("window.__e2e?.getState().hydrated", { timeoutMs: 30_000 });

  await test("Markdownを開いて表示できる", async () => {
    await open("openMarkdownFile", fixtures.basic);
    await driver.waitFor(
      `document.querySelector('[role="main"]')?.innerText.includes('smoke-marker')`
    );
    assert.equal((await state()).activeTab.renderMode, "full");
  });

  await test("正常なMermaidをSVG表示できる", async () => {
    await open("openMarkdownFile", fixtures.validMermaid);
    await driver.waitFor("document.querySelector('.mermaid-rendered svg') !== null", {
      timeoutMs: 30_000,
    });
    const labelMetrics = await driver.evaluate(`(() => {
      const labels = [...document.querySelectorAll('.mermaid-rendered .nodeLabel p')];
      const measure = (text) => {
        const label = labels.find((element) => element.textContent.includes(text));
        if (!label) return null;
        const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight);
        const labelRect = label.getBoundingClientRect();
        const node = label.closest('g.node');
        const foreignRect = node?.querySelector('foreignObject')?.getBoundingClientRect();
        const shapeRect = node?.querySelector('rect, polygon, path')?.getBoundingClientRect();
        const contains = (outer) =>
          outer &&
          labelRect.top >= outer.top - 1 &&
          labelRect.right <= outer.right + 1 &&
          labelRect.bottom <= outer.bottom + 1 &&
          labelRect.left >= outer.left - 1;
        return {
          hasBreak: label.querySelector('br') !== null,
          lines: Math.round(label.offsetHeight / lineHeight),
          lineHeight,
          containedByForeignObject: contains(foreignRect),
          containedByShape: contains(shapeRect),
        };
      };
      const paragraph = [...document.querySelectorAll('.markdown-body > p')]
        .find((element) => element.textContent.includes('regular paragraph'));
      return {
        autoWrapped: measure('UTF-8'),
        rounded: measure('Long rounded'),
        diamond: measure('Diamond node'),
        stadium: measure('Stadium node'),
        single: measure('Single line'),
        paragraphLineHeight: paragraph ? getComputedStyle(paragraph).lineHeight : null,
      };
    })()`);
    assert.equal(labelMetrics.autoWrapped.hasBreak, false);
    assert.ok(labelMetrics.autoWrapped.lines >= 2);
    assert.equal(labelMetrics.autoWrapped.lineHeight, 24);
    assert.equal(labelMetrics.autoWrapped.containedByForeignObject, true);
    assert.equal(labelMetrics.autoWrapped.containedByShape, true);
    for (const shape of ["rounded", "diamond", "stadium"]) {
      assert.deepEqual(labelMetrics[shape], {
        hasBreak: true,
        lines: 2,
        lineHeight: 24,
        containedByForeignObject: true,
        containedByShape: true,
      });
    }
    assert.deepEqual(labelMetrics.single, {
      hasBreak: false,
      lines: 1,
      lineHeight: 24,
      containedByForeignObject: true,
      containedByShape: true,
    });
    assert.equal(labelMetrics.paragraphLineHeight, "28px");
  });

  await test("不正なMermaidをエラー表示できる", async () => {
    await open("openMarkdownFile", fixtures.invalidMermaid);
    await driver.waitFor("document.querySelector('.mermaid-error-container') !== null", {
      timeoutMs: 30_000,
    });
  });

  await test("ZIP内Markdownを表示できる", async () => {
    await open("openArchive", fixtures.archive);
    await driver.evaluate("window.__e2e.openArchiveEntry('inside.md')");
    await driver.waitFor(
      `document.querySelector('[role="main"]')?.innerText.includes('zip-smoke-marker')`
    );
  });

  await test("5 MiB境界で安全モードへ切り替わる", async () => {
    await open("openMarkdownFile", fixtures.belowLimit);
    assert.equal((await state()).activeTab.renderMode, "full");
    await open("openLargeMarkdownInSafeMode", fixtures.atLimit);
    assert.equal((await state()).activeTab.renderMode, "safe");
    await driver.waitFor(`document.querySelector('[role="main"]')?.innerText.includes('At limit')`);
  });

  await test("更新通知を表示できる", async () => {
    await driver.evaluate("window.__e2e.showUpdateAvailable()");
    await driver.waitFor(
      `Array.from(document.querySelectorAll('[role="status"]')).some((el) => el.innerText.includes('9.9.9'))`
    );
  });

  await test("リロード後にタブ・検索・スクロールを復元する", async () => {
    await driver.evaluate("window.__e2e.resetSession()");
    await open("openMarkdownFile", fixtures.basic);
    await driver.waitFor(
      "document.querySelector('[role=\"main\"]')?.scrollHeight > document.querySelector('[role=\"main\"]')?.clientHeight + 600"
    );
    await driver.key("Ctrl+F");
    await driver.waitFor("document.querySelector('input') !== null");
    await driver.evaluate(`(() => {
      const input = document.querySelector('input');
      input.value = 'smoke-marker';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const main = document.querySelector('[role="main"]');
      main.scrollTop = 600;
      main.dispatchEvent(new Event('scroll'));
    })()`);
    await driver.waitFor("window.__e2e.getState().search.query === 'smoke-marker'");
    await driver.waitFor("window.__e2e.getState().scroll.rendered >= 500");
    await driver.evaluate("window.__e2eReloadMarker = 'old-page'");
    await driver.key("Ctrl+R");
    await driver.waitFor("window.__e2eReloadMarker === undefined", { timeoutMs: 30_000 });
    await driver.waitFor("window.__e2e?.getState().hydrated", { timeoutMs: 30_000 });
    await driver.waitFor("window.__e2e.getState().search.query === 'smoke-marker'");
    await driver.waitFor("document.querySelector('[role=\"main\"]')?.scrollTop >= 500");
    const restored = await state();
    assert.equal(restored.activeTab.title, "basic.md");
    assert.equal(restored.search.open, true);
    assert.ok(restored.scroll.rendered >= 500, `scroll=${restored.scroll.rendered}`);
  });

  assert.deepEqual(diagnostics.errors, [], `ブラウザエラー: ${diagnostics.errors.join("\n")}`);
} catch (error) {
  failed = true;
  globalThis.console.error(error);
  try {
    await driver.screenshot(path.join(artifactsDir, "failure.png"));
  } catch (screenshotError) {
    globalThis.console.error("失敗時スクリーンショットを保存できませんでした:", screenshotError);
  }
  globalThis.process.exitCode = 1;
} finally {
  diagnostics?.close();
  await terminateProcessTree(child?.pid);
  rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (!failed) globalThis.console.log("WebView2 smoke tests passed.");
}
