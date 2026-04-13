/**
 * Morpheus Session Manager
 *
 * Manages multiple concurrent compute sessions, each backed by a persistent
 * TCP socket to its provider's LLM endpoint. Sessions are opened by staking
 * MOR tokens to the on-chain Diamond Proxy and closed with a signed receipt.
 *
 * Key design:
 *   - Each session gets its own http.Agent (keepAlive:true, maxSockets:1)
 *     so there is exactly ONE persistent TCP socket per provider.
 *   - A reusable buffer pool avoids per-request allocations.
 *   - Sessions auto-close before their on-chain expiry to avoid forfeiture.
 *   - The manager tracks all active sessions and exposes a unified chat()
 *     method that routes to the right provider.
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { EventEmitter } from "node:events";
import { MorpheusComputeClient, type MorpheusBid, type MorpheusSession } from "./compute-client.js";

// ---- Types ------------------------------------------------------------------

export interface SessionHandle {
  sessionId: string;
  modelId: string;
  modelName: string;
  bidId: string;
  provider: string;
  endpoint: string;
  pricePerSecond: bigint;
  stakeAmount: bigint;
  openedAt: number;
  endsAt: number;
  agent: http.Agent | https.Agent;
  alive: boolean;
  requestCount: number;
  bytesSent: number;
  bytesReceived: number;
}

export interface SessionManagerConfig {
  /** Seconds before session expiry to auto-close (default 120). */
  autoCloseLeadTimeSec?: number;
  /** Socket idle timeout in ms (default 120_000). */
  socketIdleMs?: number;
  /** Per-request timeout in ms (default 60_000). */
  requestTimeoutMs?: number;
  /** Buffer pool initial size per session in bytes (default 128 KB). */
  bufferSize?: number;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
  conversationId?: string;
  stream?: boolean;
}

export interface ChatResponse {
  sessionId: string;
  reply: string;
  tokenCount?: number;
  latencyMs: number;
}

// ---- Buffer pool ------------------------------------------------------------

class BufferPool {
  private buffers = new Map<string, Buffer>();
  private defaultSize: number;

  constructor(defaultSize = 128 * 1024) {
    this.defaultSize = defaultSize;
  }

  get(sessionId: string): Buffer {
    let buf = this.buffers.get(sessionId);
    if (!buf) {
      buf = Buffer.allocUnsafe(this.defaultSize);
      this.buffers.set(sessionId, buf);
    }
    return buf;
  }

  encode(sessionId: string, data: unknown): Buffer {
    const json = JSON.stringify(data);
    const needed = Buffer.byteLength(json, "utf8");
    let buf = this.get(sessionId);
    if (needed > buf.length) {
      buf = Buffer.allocUnsafe(Math.max(needed, buf.length * 2));
      this.buffers.set(sessionId, buf);
    }
    const written = buf.write(json, 0, needed, "utf8");
    return buf.subarray(0, written);
  }

  release(sessionId: string) {
    this.buffers.delete(sessionId);
  }
}

// ---- Session Manager --------------------------------------------------------

export class MorpheusSessionManager extends EventEmitter {
  private compute: MorpheusComputeClient;
  private sessions = new Map<string, SessionHandle>();
  private buffers: BufferPool;
  private config: Required<SessionManagerConfig>;
  private _expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(compute: MorpheusComputeClient, config: SessionManagerConfig = {}) {
    super();
    this.compute = compute;
    this.config = {
      autoCloseLeadTimeSec: config.autoCloseLeadTimeSec ?? 120,
      socketIdleMs: config.socketIdleMs ?? 120_000,
      requestTimeoutMs: config.requestTimeoutMs ?? 60_000,
      bufferSize: config.bufferSize ?? 128 * 1024,
    };
    this.buffers = new BufferPool(this.config.bufferSize);
  }

  // ---- Session lifecycle ----------------------------------------------------

  /**
   * Open a new compute session for a model.
   *
   * 1. Finds the best bid (highest reputation provider) for the model.
   * 2. Gets provider approval (off-chain handshake).
   * 3. Stakes MOR tokens on-chain.
   * 4. Opens a persistent TCP socket to the provider.
   */
  async openSession(
    modelId: string,
    stakeAmount: bigint,
    opts?: {
      modelName?: string;
      approvalEncoded?: Uint8Array;
      providerSignature?: Uint8Array;
    },
  ): Promise<SessionHandle> {
    // 1. Select best provider
    const best = await this.compute.selectBestBid(modelId);
    if (!best) throw new Error(`No active bids for model ${modelId}`);

    const { bid, provider } = best;
    const endpoint = provider?.endpoint ?? "";
    if (!endpoint) throw new Error(`Provider ${bid.provider} has no endpoint`);

    // 2. Get provider approval (off-chain).
    // In production this involves an HTTP handshake with the provider's endpoint.
    // The caller can supply pre-fetched approval, or we fetch it here.
    let approvalEncoded = opts?.approvalEncoded;
    let providerSignature = opts?.providerSignature;

    if (!approvalEncoded || !providerSignature) {
      const approval = await this._requestProviderApproval(endpoint, bid);
      approvalEncoded = approval.approvalEncoded;
      providerSignature = approval.signature;
    }

    // 3. Open on-chain session (stakes MOR).
    const sessionId = await this.compute.openSession(
      stakeAmount,
      approvalEncoded,
      providerSignature,
    );

    // 4. Fetch session details from chain.
    const session = await this.compute.getSession(sessionId);
    if (!session) throw new Error("Session opened on-chain but could not read it back");

    // 5. Create persistent TCP socket to provider.
    const handle = this._createHandle(sessionId, modelId, opts?.modelName ?? "", bid, endpoint, stakeAmount, session);
    this.sessions.set(sessionId, handle);

    // 6. Schedule auto-close before expiry.
    this._scheduleAutoClose(handle);

    this.emit("session:opened", handle);
    return handle;
  }

  /**
   * Close a session — sends closeout receipt to chain and tears down the socket.
   */
  async closeSession(sessionId: string, receipt?: { encoded: Uint8Array; signature: Uint8Array }): Promise<void> {
    const handle = this.sessions.get(sessionId);
    if (!handle) throw new Error(`Session ${sessionId} not found`);

    handle.alive = false;

    // Cancel expiry timer.
    const timer = this._expiryTimers.get(sessionId);
    if (timer) { clearTimeout(timer); this._expiryTimers.delete(sessionId); }

    // Close on-chain if receipt provided.
    if (receipt) {
      try {
        await this.compute.closeSession(receipt.encoded, receipt.signature);
      } catch (e) {
        this.emit("session:error", { sessionId, error: e });
      }
    }

    // Destroy the socket pool.
    handle.agent.destroy();
    this.buffers.release(sessionId);
    this.sessions.delete(sessionId);

    this.emit("session:closed", { sessionId });
  }

  // ---- Chat via session -----------------------------------------------------

  /**
   * Send a chat message through a session's persistent socket.
   * Routes to the provider's OpenAI-compatible /v1/chat/completions endpoint.
   */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const handle = this.sessions.get(req.sessionId);
    if (!handle) throw new Error(`Session ${req.sessionId} not found`);
    if (!handle.alive) throw new Error(`Session ${req.sessionId} is closed`);

    const start = Date.now();
    const payload = this.buffers.encode(req.sessionId, {
      model: handle.modelName || handle.modelId,
      messages: [{ role: "user", content: req.message }],
      stream: false,
    });

    const data = await this._httpPost(handle, "/v1/chat/completions", payload);
    const latencyMs = Date.now() - start;

    handle.requestCount++;
    handle.bytesSent += payload.length;
    handle.bytesReceived += Buffer.byteLength(JSON.stringify(data), "utf8");

    const reply = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
    const tokenCount = data?.usage?.total_tokens;

    return { sessionId: req.sessionId, reply, tokenCount, latencyMs };
  }

  // ---- Query ----------------------------------------------------------------

  getSession(sessionId: string): SessionHandle | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): SessionHandle[] {
    return [...this.sessions.values()];
  }

  getActiveSessions(): SessionHandle[] {
    return [...this.sessions.values()].filter((s) => s.alive);
  }

  stats() {
    const sessions = this.listSessions();
    return {
      total: sessions.length,
      active: sessions.filter((s) => s.alive).length,
      totalRequests: sessions.reduce((n, s) => n + s.requestCount, 0),
      totalBytesSent: sessions.reduce((n, s) => n + s.bytesSent, 0),
      totalBytesReceived: sessions.reduce((n, s) => n + s.bytesReceived, 0),
    };
  }

  // ---- Internals ------------------------------------------------------------

  private _createHandle(
    sessionId: string,
    modelId: string,
    modelName: string,
    bid: MorpheusBid,
    endpoint: string,
    stakeAmount: bigint,
    session: MorpheusSession,
  ): SessionHandle {
    const u = new URL(endpoint);
    const isHttps = u.protocol === "https:";

    // One persistent keep-alive socket per session.
    const AgentClass = isHttps ? https.Agent : http.Agent;
    const agent = new AgentClass({
      keepAlive: true,
      keepAliveMsecs: this.config.socketIdleMs,
      maxSockets: 1,
      maxFreeSockets: 1,
      timeout: this.config.requestTimeoutMs,
    });

    return {
      sessionId,
      modelId,
      modelName,
      bidId: bid.bidId,
      provider: bid.provider,
      endpoint,
      pricePerSecond: bid.pricePerSecond,
      stakeAmount,
      openedAt: session.openedAt,
      endsAt: session.endsAt,
      agent,
      alive: true,
      requestCount: 0,
      bytesSent: 0,
      bytesReceived: 0,
    };
  }

  private _scheduleAutoClose(handle: SessionHandle) {
    const now = Math.floor(Date.now() / 1000);
    const closeAt = handle.endsAt - this.config.autoCloseLeadTimeSec;
    const delayMs = Math.max(0, (closeAt - now) * 1000);

    const timer = setTimeout(async () => {
      if (handle.alive) {
        this.emit("session:expiring", { sessionId: handle.sessionId });
        try {
          await this.closeSession(handle.sessionId);
        } catch (e) {
          this.emit("session:error", { sessionId: handle.sessionId, error: e });
        }
      }
    }, delayMs);

    this._expiryTimers.set(handle.sessionId, timer);
  }

  /**
   * Request provider approval via their off-chain HTTP endpoint.
   * The Morpheus proxy-router exposes POST /proxy/sessions/initiate
   * which returns the signed approval for openSession().
   */
  private async _requestProviderApproval(
    endpoint: string,
    bid: MorpheusBid,
  ): Promise<{ approvalEncoded: Uint8Array; signature: Uint8Array }> {
    // Providers typically run a Morpheus proxy-router that serves this.
    const url = new URL("/proxy/sessions/initiate", endpoint);
    const body = JSON.stringify({ bidId: bid.bidId });

    return new Promise((resolve, reject) => {
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 15_000,
      }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            const approval = typeof json.approval === "string"
              ? Buffer.from(json.approval.replace(/^0x/, ""), "hex")
              : Buffer.from(json.approval || "");
            const sig = typeof json.signature === "string"
              ? Buffer.from(json.signature.replace(/^0x/, ""), "hex")
              : Buffer.from(json.signature || "");
            resolve({ approvalEncoded: approval, signature: sig });
          } catch (e) {
            reject(new Error("Invalid provider approval response: " + data.slice(0, 200)));
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("Provider approval timeout")));
      req.write(body);
      req.end();
    });
  }

  /**
   * Send an HTTP POST through a session's persistent socket.
   * Uses the session's dedicated http.Agent so the TCP connection is reused.
   */
  private _httpPost(handle: SessionHandle, path: string, payload: Buffer): Promise<any> {
    return new Promise((resolve, reject) => {
      const u = new URL(handle.endpoint);
      const lib = u.protocol === "https:" ? https : http;

      const req = lib.request({
        method: "POST",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path,
        agent: handle.agent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          Accept: "application/json",
        },
        timeout: this.config.requestTimeoutMs,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ raw }); }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("Provider request timeout")));
      req.write(payload);
      req.end();
    });
  }

  // ---- Cleanup --------------------------------------------------------------

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      try { await this.closeSession(id); } catch { /* best effort */ }
    }
  }

  destroy() {
    for (const timer of this._expiryTimers.values()) clearTimeout(timer);
    this._expiryTimers.clear();
    for (const handle of this.sessions.values()) {
      handle.alive = false;
      handle.agent.destroy();
    }
    this.sessions.clear();
    this.removeAllListeners();
  }
}

export default MorpheusSessionManager;
