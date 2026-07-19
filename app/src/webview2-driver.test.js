// @ts-nocheck -- Node WebSocketの最小モックを使うドライバ単体テスト。
import { describe, expect, it } from "vitest";
import { connectCdp, WebView2Driver } from "../scripts/webview2-driver.mjs";

class SilentWebSocket extends globalThis.EventTarget {
  constructor() {
    super();
    globalThis.queueMicrotask(() => this.dispatchEvent(new globalThis.Event("open")));
  }

  send() {}
  close() {
    this.dispatchEvent(new globalThis.Event("close"));
  }
}

class FalseWebSocket extends SilentWebSocket {
  send(payload) {
    const { id } = JSON.parse(payload);
    globalThis.queueMicrotask(() =>
      this.dispatchEvent(
        new globalThis.MessageEvent("message", {
          data: JSON.stringify({ id, result: { result: { value: false } } }),
        })
      )
    );
  }
}

describe("connectCdp", () => {
  it("rejects a CDP command that never receives a response", async () => {
    const original = globalThis.WebSocket;
    globalThis.WebSocket = SilentWebSocket;
    try {
      const client = await connectCdp("ws://example.invalid", { timeoutMs: 10 });
      await expect(client.send("Runtime.evaluate")).rejects.toThrow("タイムアウト");
      client.close();
    } finally {
      globalThis.WebSocket = original;
    }
  });

  it("keeps the outer waitFor deadline when CDP never responds", async () => {
    const originalWebSocket = globalThis.WebSocket;
    const originalFetch = globalThis.fetch;
    globalThis.WebSocket = SilentWebSocket;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [
        {
          url: "http://localhost:1420/",
          webSocketDebuggerUrl: "ws://example.invalid",
        },
      ],
    });
    try {
      const driver = new WebView2Driver({ port: 1 });
      const started = Date.now();
      await expect(driver.waitFor("false", { timeoutMs: 30, intervalMs: 1 })).rejects.toThrow(
        "タイムアウト"
      );
      expect(Date.now() - started).toBeLessThan(100);
    } finally {
      globalThis.WebSocket = originalWebSocket;
      globalThis.fetch = originalFetch;
    }
  });

  it("clamps the polling interval to the outer deadline", async () => {
    const originalWebSocket = globalThis.WebSocket;
    const originalFetch = globalThis.fetch;
    globalThis.WebSocket = FalseWebSocket;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [
        {
          url: "http://localhost:1420/",
          webSocketDebuggerUrl: "ws://example.invalid",
        },
      ],
    });
    try {
      const driver = new WebView2Driver({ port: 1 });
      const started = Date.now();
      await expect(driver.waitFor("false", { timeoutMs: 30, intervalMs: 500 })).rejects.toThrow(
        "タイムアウト"
      );
      expect(Date.now() - started).toBeLessThan(100);
    } finally {
      globalThis.WebSocket = originalWebSocket;
      globalThis.fetch = originalFetch;
    }
  });
});
