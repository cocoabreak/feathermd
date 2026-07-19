#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WebView2Driver,
  launchTauriDev,
  terminateProcessTree,
} from "../../../app/scripts/webview2-driver.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(currentDir, "..", "..", "..", "app");
const pidFile = path.join(currentDir, ".driver-pid");
const port = 9222;
const driver = new WebView2Driver({ port });

async function launch() {
  const profileDir = path.join(currentDir, ".webview2-profile");
  mkdirSync(profileDir, { recursive: true });
  const child = launchTauriDev({ appDir, port, profileDir, detached: true });
  writeFileSync(pidFile, String(child.pid));
  console.log(`起動しました (pid=${child.pid})。CDP応答待ち...`);
  await driver.waitForCdp();
  console.log("CDP準備完了。");
}

async function quit() {
  if (!existsSync(pidFile)) {
    console.log("PIDファイルがありません（起動していない?）");
    return;
  }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  unlinkSync(pidFile);
  await terminateProcessTree(pid);
  console.log("終了しました。");
}

const [, , command, ...args] = process.argv;

try {
  switch (command) {
    case "launch":
      await launch();
      break;
    case "targets":
      console.log(JSON.stringify(await driver.targets(), null, 2));
      break;
    case "eval":
      console.log(JSON.stringify((await driver.evaluate(args.join(" "))) ?? null, null, 2));
      break;
    case "screenshot": {
      const outPath = path.resolve(args[0]);
      await driver.screenshot(outPath);
      console.log(`保存しました: ${outPath}`);
      break;
    }
    case "click":
      console.log(JSON.stringify(await driver.click(args[0])));
      break;
    case "mouseDrag":
      await driver.mouseDrag(args[0], args[1]);
      console.log("OK");
      break;
    case "key":
      console.log(JSON.stringify(await driver.key(args[0])));
      break;
    case "openFile": {
      const normalized = args[0].replace(/\\/g, "/");
      console.log(
        JSON.stringify(
          await driver.evaluate(
            `window.__e2e ? (async () => { await window.__e2e.openMarkdownFile(${JSON.stringify(normalized)}); return "OK"; })() : "NO_HOOK"`
          )
        )
      );
      break;
    }
    case "quit":
      await quit();
      break;
    default:
      throw new Error(
        "使い方: node driver.mjs <launch|targets|eval|screenshot|click|mouseDrag|key|openFile|quit> [args...]"
      );
  }
} catch (error) {
  console.error("エラー:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
