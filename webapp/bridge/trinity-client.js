// trinity-client.js
// Thin HTTP client for the trinity-agent container's gateway API.
// The Trinity container exposes its gateway on http://127.0.0.1:18789 (see docker-compose).
// This module is deliberately tiny — no deps — so the bridge can ship standalone.

const http  = require("http");
const https = require("https");
const { URL } = require("url");

class TrinityClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    // In-memory conversation store so the webapp can show history even if the
    // gateway container restarts. Keyed by conversationId.
    this._history = new Map();
  }

  _post(pathname, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(this.baseUrl + pathname);
      const lib = u.protocol === "https:" ? https : http;
      const payload = JSON.stringify(body || {});
      const req = lib.request({
        method: "POST",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 120_000,
      }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(data ? JSON.parse(data) : {}); }
            catch { resolve({ raw: data }); }
          } else {
            reject(new Error("trinity agent " + res.statusCode + ": " + data.slice(0, 200)));
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("trinity agent timeout")));
      req.write(payload);
      req.end();
    });
  }

  async chat(message, conversationId = "default") {
    const hist = this._history.get(conversationId) || [];
    hist.push({ role: "user", content: message, ts: Date.now() });

    let reply;
    try {
      // Trinity gateway is expected to expose POST /chat or similar.
      // If your Trinity build uses a different endpoint, change this single call.
      const res = await this._post("/chat", { message, conversationId });
      reply = res && (res.reply || res.message || res.content) || "(no reply)";
    } catch (e) {
      // If the agent isn't reachable the bridge still gives the webapp a useful
      // message rather than a hard failure — important during onboarding.
      reply = "⚠ Trinity agent not reachable: " + e.message;
    }

    hist.push({ role: "agent", content: reply, ts: Date.now() });
    // Trim history to the last 200 messages per conversation.
    if (hist.length > 200) hist.splice(0, hist.length - 200);
    this._history.set(conversationId, hist);
    return { reply, conversationId };
  }

  history(conversationId = "default") {
    return { messages: this._history.get(conversationId) || [] };
  }
}

module.exports = TrinityClient;
