// @ts-nocheck -- Node専用の依存ゼロCDPドライバ。Svelteのブラウザ向けtsconfig対象外。
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const DEFAULT_DEV_URL = "http://localhost:1420";
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

function remainingTime(deadline) {
  return Math.max(1, deadline - Date.now());
}

export async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export function launchTauriDev({ appDir, port, profileDir, stateDir, logPath, detached = false }) {
  mkdirSync(profileDir, { recursive: true });
  let logFd;
  const stdio = logPath
    ? (() => {
        mkdirSync(path.dirname(logPath), { recursive: true });
        logFd = openSync(logPath, "w");
        return ["ignore", logFd, logFd];
      })()
    : "ignore";
  const child = spawn("cmd.exe", ["/c", "npm", "run", "tauri", "dev"], {
    cwd: appDir,
    env: {
      ...globalThis.process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: profileDir,
      FEATHERMD_E2E_DISABLE_SINGLE_INSTANCE: "1",
      ...(stateDir ? { FEATHERMD_E2E_STATE_DIR: stateDir } : {}),
    },
    detached,
    stdio,
    windowsHide: true,
  });
  if (detached) child.unref();
  child.once("exit", () => {
    if (logFd !== undefined) closeSync(logFd);
  });
  return child;
}

export async function terminateProcessTree(pid) {
  if (!pid) return;
  await new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolve());
    killer.once("exit", () => resolve());
  });
}

export function connectCdp(wsUrl, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new globalThis.WebSocket(wsUrl);
    let nextId = 1;
    let opened = false;
    const pending = new Map();
    const connectionTimer = globalThis.setTimeout(() => {
      ws.close();
      reject(new Error(`CDP接続が${timeoutMs}msでタイムアウトしました`));
    }, timeoutMs);

    function rejectPending(error) {
      for (const { reject: rejectCommand, timer } of pending.values()) {
        globalThis.clearTimeout(timer);
        rejectCommand(error);
      }
      pending.clear();
    }

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) {
        onEvent?.(message);
        return;
      }
      const { resolve: resolvePending, reject: rejectCommand, timer } = pending.get(message.id);
      pending.delete(message.id);
      globalThis.clearTimeout(timer);
      if (message.error) rejectCommand(new Error(message.error.message));
      else resolvePending(message.result);
    });
    ws.addEventListener("error", () => {
      const error = new Error("CDP WebSocketでエラーが発生しました");
      if (!opened) {
        globalThis.clearTimeout(connectionTimer);
        reject(error);
      }
      rejectPending(error);
    });
    ws.addEventListener("close", () => {
      const error = new Error("CDP WebSocketが切断されました");
      if (!opened) {
        globalThis.clearTimeout(connectionTimer);
        reject(error);
      }
      rejectPending(error);
    });
    ws.addEventListener("open", () => {
      opened = true;
      globalThis.clearTimeout(connectionTimer);
      resolve({
        send(method, params = {}, commandTimeoutMs = timeoutMs) {
          const id = nextId++;
          return new Promise((resolvePending, rejectPending) => {
            const timer = globalThis.setTimeout(() => {
              pending.delete(id);
              rejectPending(
                new Error(`CDPコマンド${method}が${commandTimeoutMs}msでタイムアウトしました`)
              );
            }, commandTimeoutMs);
            pending.set(id, { resolve: resolvePending, reject: rejectPending, timer });
            try {
              ws.send(JSON.stringify({ id, method, params }));
            } catch (error) {
              globalThis.clearTimeout(timer);
              pending.delete(id);
              rejectPending(error);
            }
          });
        },
        close() {
          ws.close();
        },
      });
    });
  });
}

export class WebView2Driver {
  constructor({ port, devUrl = DEFAULT_DEV_URL }) {
    this.port = port;
    this.devUrl = devUrl;
  }

  async waitForCdp(timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await globalThis.fetch(`http://127.0.0.1:${this.port}/json/version`, {
          signal: globalThis.AbortSignal.timeout(1_000),
        });
        if (response.ok) return;
      } catch {
        // 起動待ち
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
    }
    throw new Error(`CDPポート${this.port}がタイムアウトまでに応答しませんでした`);
  }

  async targets(timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    const response = await globalThis.fetch(`http://127.0.0.1:${this.port}/json`, {
      signal: globalThis.AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`CDPターゲット取得に失敗しました: ${response.status}`);
    return await response.json();
  }

  async connect({ onEvent, deadline = Date.now() + DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    const targets = await this.targets(remainingTime(deadline));
    const target = targets.find((candidate) => candidate.url?.startsWith(this.devUrl));
    if (!target) {
      throw new Error(`アプリのCDPターゲットが見つかりません: ${JSON.stringify(targets)}`);
    }
    return await connectCdp(target.webSocketDebuggerUrl, {
      timeoutMs: remainingTime(deadline),
      onEvent,
    });
  }

  async observeDiagnostics(timeoutMs = 30_000) {
    const errors = [];
    const deadline = Date.now() + timeoutMs;
    const onEvent = (message) => {
      if (message.method === "Runtime.exceptionThrown") {
        errors.push(`exception: ${message.params?.exceptionDetails?.text ?? "unknown"}`);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        const text = (message.params.args ?? [])
          .map((argument) => argument.value ?? argument.description ?? "")
          .join(" ");
        errors.push(`console.error: ${text}`);
      }
      if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
        errors.push(`log.error: ${message.params.entry.text}`);
      }
    };
    let client;
    while (!client && Date.now() < deadline) {
      try {
        client = await this.connect({
          onEvent,
          deadline: Date.now() + Math.min(1_000, remainingTime(deadline)),
        });
      } catch {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
      }
    }
    if (!client) throw new Error("診断用CDPターゲット待機がタイムアウトしました");
    try {
      await client.send("Runtime.enable", {}, remainingTime(deadline));
      await client.send("Log.enable", {}, remainingTime(deadline));
    } catch (error) {
      client.close();
      throw error;
    }
    return {
      errors,
      close: () => client.close(),
    };
  }

  async evaluate(expression, { deadline = Date.now() + DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    const client = await this.connect({ deadline });
    try {
      const result = await client.send(
        "Runtime.evaluate",
        {
          expression,
          returnByValue: true,
          awaitPromise: true,
        },
        remainingTime(deadline)
      );
      if (result.exceptionDetails) {
        throw new Error(`WebView評価に失敗しました: ${JSON.stringify(result.exceptionDetails)}`);
      }
      return result.result.value;
    } finally {
      client.close();
    }
  }

  async waitFor(expression, { timeoutMs = 15_000, intervalMs = 100 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastValue;
    while (Date.now() < deadline) {
      try {
        lastValue = await this.evaluate(expression, { deadline });
        if (lastValue) return lastValue;
      } catch {
        // reload中など一時的なCDP切断は期限まで再試行する
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) =>
        globalThis.setTimeout(resolve, Math.min(intervalMs, remaining))
      );
    }
    throw new Error(`条件待機がタイムアウトしました: ${expression} (last=${lastValue})`);
  }

  async screenshot(outPath) {
    const client = await this.connect();
    try {
      const result = await client.send("Page.captureScreenshot", { format: "png" });
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, Buffer.from(result.data, "base64"));
    } finally {
      client.close();
    }
  }

  async click(selector) {
    return await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return "NOT_FOUND";
      element.click();
      return "OK";
    })()`);
  }

  async key(combo) {
    const parts = combo.split("+");
    const key = parts.pop();
    const modifiers = new Set(parts.map((part) => part.toLowerCase()));
    return await this.evaluate(`(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", {
        key: ${JSON.stringify(key)},
        ctrlKey: ${modifiers.has("ctrl")},
        shiftKey: ${modifiers.has("shift")},
        altKey: ${modifiers.has("alt")},
        bubbles: true,
      }));
      return "OK";
    })()`);
  }

  async mouseDrag(fromSelector, toSelector) {
    const client = await this.connect();
    try {
      const coordinates = await client.send("Runtime.evaluate", {
        expression: `(() => {
          const from = document.querySelector(${JSON.stringify(fromSelector)});
          const to = document.querySelector(${JSON.stringify(toSelector)});
          if (!from || !to) return null;
          const fromRect = from.getBoundingClientRect();
          const toRect = to.getBoundingClientRect();
          return {
            from: { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 },
            to: { x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 },
          };
        })()`,
        returnByValue: true,
      });
      const points = coordinates.result.value;
      if (!points)
        throw new Error(`ドラッグ対象が見つかりません: ${fromSelector} -> ${toSelector}`);
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: points.from.x,
        y: points.from.y,
      });
      await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: points.from.x,
        y: points.from.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: (points.from.x + points.to.x) / 2,
        y: (points.from.y + points.to.y) / 2,
        button: "left",
        buttons: 1,
      });
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: points.to.x,
        y: points.to.y,
        button: "left",
        buttons: 1,
      });
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: points.to.x,
        y: points.to.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    } finally {
      client.close();
    }
  }
}
