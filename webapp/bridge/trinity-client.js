// trinity-client.js
// Persistent WebSocket RPC client for the Trinity gateway container.
//
// The gateway exposes a WebSocket endpoint on ws://127.0.0.1:18789.
// Protocol: JSON messages of the form:
//   Request:  { type: "req", id: "<unique>", method: "<method>", params: {...} }
//   Response: { type: "res", id: "<same-id>", ok: true/false, payload: {...}, error?: {...} }
//   Event:    { type: "event", event: "<name>", payload: {...} }
//
// This client maintains a SINGLE persistent WebSocket connection with automatic
// reconnect. All bridge modules share this connection.

const WebSocket = require("ws");
const crypto = require("crypto");

class TrinityClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "").replace(/^http/, "ws");
    this._ws = null;
    this._pending = new Map();     // id → { resolve, reject, timer }
    this._history = new Map();     // conversationId → messages[]
    this._eventHandlers = new Map(); // event name → Set<fn>
    this._reconnectTimer = null;
    this._reconnectDelay = 1000;
    this._connected = false;
    this._destroyed = false;
    this._connect();
  }

  // ---- WebSocket lifecycle --------------------------------------------------

  _connect() {
    if (this._destroyed) return;
    try {
      this._ws = new WebSocket(this.baseUrl);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }

    this._ws.on("open", () => {
      this._connected = true;
      this._reconnectDelay = 1000;
      console.log("[TrinityClient] Connected to gateway at", this.baseUrl);
    });

    this._ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === "res" && msg.id && this._pending.has(msg.id)) {
        const p = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.payload ?? msg);
        else p.reject(new Error((msg.error && msg.error.message) || "RPC error"));
      } else if (msg.type === "event" && msg.event) {
        const handlers = this._eventHandlers.get(msg.event);
        if (handlers) handlers.forEach((fn) => fn(msg.payload));
      }
      // chat.send streams partial text as events — collect them.
      if (msg.type === "chat.delta" || msg.type === "chat.text") {
        const handlers = this._eventHandlers.get("chat.delta");
        if (handlers) handlers.forEach((fn) => fn(msg));
      }
    });

    this._ws.on("close", () => {
      this._connected = false;
      this._rejectAllPending("WebSocket closed");
      this._scheduleReconnect();
    });

    this._ws.on("error", (err) => {
      // Suppress ECONNREFUSED noise — the gateway might not be up yet.
      if (err.code !== "ECONNREFUSED") {
        console.error("[TrinityClient] WS error:", err.message);
      }
    });
  }

  _scheduleReconnect() {
    if (this._destroyed) return;
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30_000);
      this._connect();
    }, this._reconnectDelay);
  }

  _rejectAllPending(reason) {
    for (const [id, p] of this._pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this._pending.clear();
  }

  get connected() { return this._connected; }

  // ---- RPC ------------------------------------------------------------------

  /**
   * Send an RPC request and wait for the response.
   * @param {string} method  RPC method name (e.g. "chat.send", "health").
   * @param {object} params  Method parameters.
   * @param {number} timeoutMs  Timeout in ms (default 120s).
   * @returns {Promise<any>} Resolved payload.
   */
  rpc(method, params = {}, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
      if (!this._connected || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("Gateway not connected at " + this.baseUrl));
      }
      const id = crypto.randomBytes(8).toString("hex");
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`RPC ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this._pending.set(id, { resolve, reject, timer });
      this._ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  /**
   * Subscribe to gateway events.
   */
  on(event, fn) {
    if (!this._eventHandlers.has(event)) this._eventHandlers.set(event, new Set());
    this._eventHandlers.get(event).add(fn);
  }

  off(event, fn) {
    const s = this._eventHandlers.get(event);
    if (s) s.delete(fn);
  }

  // ---- High-level API (used by bridge-server.js routes) ---------------------

  /** Gateway health. */
  async health() {
    try { return await this.rpc("health", {}, 5000); }
    catch { return { ok: false }; }
  }

  /** Gateway status. */
  async status() {
    try { return await this.rpc("status", {}, 5000); }
    catch { return { ok: false }; }
  }

  /** List models configured in the gateway. */
  async listModels() {
    return this.rpc("models.list", {}, 10_000);
  }

  /** List chat sessions. */
  async listSessions(offset = 0, limit = 50) {
    return this.rpc("sessions.list", { offset, limit }, 10_000);
  }

  /** Get session preview (recent messages). */
  async sessionPreview(sessionKey) {
    return this.rpc("sessions.preview", { sessionKey }, 10_000);
  }

  /** Get chat history for a session. */
  async chatHistory(sessionKey) {
    return this.rpc("chat.history", { sessionKey }, 10_000);
  }

  /** Get gateway config. */
  async getConfig() {
    return this.rpc("config.get", {}, 5000);
  }

  /** Update gateway config. */
  async setConfig(patch) {
    return this.rpc("config.set", patch, 10_000);
  }

  /** List agents. */
  async listAgents() {
    return this.rpc("agents.list", {}, 10_000);
  }

  /** Abort a running chat. */
  async chatAbort(sessionKey) {
    return this.rpc("chat.abort", { sessionKey }, 5000);
  }

  // ---- Chat (with history tracking) ----------------------------------------

  /**
   * Send a chat message via the gateway's chat.send RPC.
   * Tracks conversation history locally for the webapp.
   */
  async chat(message, conversationId = "default") {
    const hist = this._history.get(conversationId) || [];
    hist.push({ role: "user", content: message, ts: Date.now() });

    let reply;
    try {
      const res = await this.rpc("chat.send", {
        sessionKey: conversationId,
        message,
        idempotencyKey: crypto.randomBytes(8).toString("hex"),
      }, 120_000);

      // The response may contain the full reply or a reference to it.
      reply = res && (res.text || res.reply || res.message || res.content);
      if (!reply && res && res.messages) {
        // chat.send might return the full message list.
        const last = res.messages[res.messages.length - 1];
        reply = last && (last.content || last.text) || "(no reply)";
      }
      if (!reply) reply = "(no reply)";
    } catch (e) {
      reply = "⚠ " + e.message;
    }

    hist.push({ role: "agent", content: reply, ts: Date.now() });
    if (hist.length > 200) hist.splice(0, hist.length - 200);
    this._history.set(conversationId, hist);
    return { reply, conversationId };
  }

  history(conversationId = "default") {
    return { messages: this._history.get(conversationId) || [] };
  }

  // ---- Cleanup --------------------------------------------------------------

  destroy() {
    this._destroyed = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._rejectAllPending("client destroyed");
    if (this._ws) this._ws.close();
  }
}

module.exports = TrinityClient;
