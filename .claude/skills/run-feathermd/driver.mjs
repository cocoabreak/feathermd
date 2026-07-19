#!/usr/bin/env node
// FeatherMD (Tauri v2 + WebView2) 用のCDPベースE2Eドライバー。
// npm/npx追加インストールなし（Node組み込みのfetch/WebSocketのみ使用）。
//
// 使い方: node driver.mjs <command> [args...]
//   launch                起動（--remote-debugging-portを有効化してnpm run tauri devを起動、PIDファイルに記録）
//   targets               CDPターゲット一覧を表示（デバッグ用）
//   screenshot <path>      WebViewのスクリーンショットをPNGで保存
//   eval <js>              WebView内でJSを評価しJSON結果を表示（Promiseはawaitされる）
//   click <selector>       document.querySelector(selector).click()
//   key <combo>            例: "Ctrl+W" のようなキーをwindowにdispatchKeyEvent
//   openFile <path>        window.__e2e.openMarkdownFile(path) を呼ぶ（devビルド限定フック）
//   quit                   PIDファイルのプロセスツリーをtaskkillで終了

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..", "..", "..", "app");
const PID_FILE = path.join(__dirname, ".driver-pid");
const CDP_PORT = 9222;
const DEV_URL = "http://localhost:1420";

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return;
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`CDPポート${CDP_PORT}がタイムアウトまでに応答しませんでした`);
}

async function cmdLaunch() {
  // WebView2は既定でアプリ識別子(com.cocoabreak.feathermd)ごとに固定の
  // user-data-dirを使う。同じidentifierの別インスタンス(リリースビルド等)が
  // 既に起動中だとプロファイルが排他ロックされ、このプロセスのWebViewが
  // 初期化できずCDPポートも永久に開かない。専用ディレクトリに退避して回避する。
  const profileDir = path.join(__dirname, ".webview2-profile");
  mkdirSync(profileDir, { recursive: true });

  const child = spawn("cmd.exe", ["/c", "npm", "run", "tauri", "dev"], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
      WEBVIEW2_USER_DATA_FOLDER: profileDir,
    },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  console.log(`起動しました (pid=${child.pid})。CDP応答待ち...`);
  await waitForCdp(180_000);
  console.log("CDP準備完了。");
}

async function getTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  return res.json();
}

async function cmdTargets() {
  const targets = await getTargets();
  console.log(JSON.stringify(targets, null, 2));
}

async function findAppTarget() {
  const targets = await getTargets();
  const target = targets.find((t) => t.url && t.url.startsWith(DEV_URL));
  if (!target) {
    throw new Error(
      `アプリのターゲットが見つかりません。targets:\n${JSON.stringify(targets, null, 2)}`
    );
  }
  return target;
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();

    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    ws.addEventListener("error", (ev) => reject(ev));
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          ws.close();
        },
      });
    });
  });
}

async function connect() {
  const target = await findAppTarget();
  return cdpConnect(target.webSocketDebuggerUrl);
}

async function cmdEval(js) {
  const client = await connect();
  const result = await client.send("Runtime.evaluate", {
    expression: js,
    returnByValue: true,
    awaitPromise: true,
  });
  client.close();
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
  }
  console.log(JSON.stringify(result.result.value ?? null, null, 2));
}

async function cmdScreenshot(outPath) {
  const client = await connect();
  const result = await client.send("Page.captureScreenshot", { format: "png" });
  client.close();
  const resolved = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, Buffer.from(result.data, "base64"));
  console.log(`保存しました: ${resolved}`);
}

async function cmdClick(selector) {
  const escaped = selector.replace(/"/g, '\\"');
  // element.click()はundefinedを返すため、`el?.click() ?? "NOT_FOUND"`のような式は
  // クリックが成功してもundefined ?? "NOT_FOUND"で常に"NOT_FOUND"になってしまう
  // （見つからなかった場合と区別できない）。found/not-foundを明示的に分けて返す。
  const js = `(() => {
    const el = document.querySelector("${escaped}");
    if (!el) return "NOT_FOUND";
    el.click();
    return "OK";
  })()`;
  await cmdEval(js);
}

async function cmdKey(combo) {
  const parts = combo.split("+");
  const key = parts.pop();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  // window.dispatchEventだと e.target が window になり、アプリ側の
  // target.matches(...) 呼び出しが例外(matchesが存在しない)を起こして
  // 握りつぶされるため、document.body起点でbubbleさせてwindowへ届かせる。
  const js = `
    document.body.dispatchEvent(new KeyboardEvent("keydown", {
      key: ${JSON.stringify(key)},
      ctrlKey: ${mods.has("ctrl")},
      shiftKey: ${mods.has("shift")},
      altKey: ${mods.has("alt")},
      bubbles: true,
    }));
    "OK"
  `;
  await cmdEval(js);
}

async function cmdOpenFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  await cmdEval(
    `window.__e2e ? (async () => { await window.__e2e.openMarkdownFile(${JSON.stringify(normalized)}); return "OK"; })() : "NO_HOOK"`
  );
}

function cmdQuit() {
  if (!existsSync(PID_FILE)) {
    console.log("PIDファイルがありません（起動していない?）");
    return;
  }
  const pid = readFileSync(PID_FILE, "utf-8").trim();
  spawn("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "inherit" });
  unlinkSync(PID_FILE);
}

const [, , command, ...args] = process.argv;

try {
  switch (command) {
    case "launch":
      await cmdLaunch();
      break;
    case "targets":
      await cmdTargets();
      break;
    case "eval":
      await cmdEval(args.join(" "));
      break;
    case "screenshot":
      await cmdScreenshot(args[0]);
      break;
    case "click":
      await cmdClick(args[0]);
      break;
    case "key":
      await cmdKey(args[0]);
      break;
    case "openFile":
      await cmdOpenFile(args[0]);
      break;
    case "quit":
      cmdQuit();
      break;
    default:
      console.error(
        "使い方: node driver.mjs <launch|targets|eval|screenshot|click|key|openFile|quit> [args...]"
      );
      process.exit(1);
  }
} catch (e) {
  console.error("エラー:", e.message ?? e);
  process.exit(1);
}
