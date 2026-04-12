/**
 * Trinity Brain Client
 *
 * Provides a single persistent HTTP connection between the Trinity gateway
 * (Node.js container) and the trinity-brain container (FastAPI, port 8100).
 *
 * Design goals:
 *   - ONE long-lived TCP socket with HTTP keep-alive (no per-request connections)
 *   - Reusable pre-allocated buffer for JSON serialisation
 *   - Automatic reconnect on socket errors
 *   - Zero dependency on third-party HTTP libraries — uses Node's built-in
 *     http.Agent with keepAlive:true
 *   - Singleton pattern so every consumer in the gateway shares the same pool
 *
 * Every module that needs to talk to the brain (serenity, memory, commands)
 * should import { brain } from "../brain/client.js" and call brain.post(...)
 * instead of raw fetch().
 */

import http from "node:http";
import { URL } from "node:url";

// ---- Types ------------------------------------------------------------------

export interface BrainResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export interface BrainClientOptions {
  baseUrl?: string;
  /** Max sockets in the keep-alive pool (default 1 — single persistent conn). */
  maxSockets?: number;
  /** Socket idle timeout in ms before the keep-alive socket is closed (default 60 s). */
  keepAliveMs?: number;
  /** Per-request timeout in ms (default 30 s). */
  timeoutMs?: number;
  /** Size of the pre-allocated serialisation buffer in bytes (default 256 KB). */
  bufferSize?: number;
}

// ---- Reusable buffer --------------------------------------------------------

/**
 * A simple growing buffer that avoids re-allocating for every JSON.stringify.
 * Most brain requests are small (< 10 KB); this avoids GC churn for the common case.
 */
class ReusableBuffer {
  private buf: Buffer;

  constructor(initialSize: number) {
    this.buf = Buffer.allocUnsafe(initialSize);
  }

  /** Encode `data` as JSON into the internal buffer, growing if needed.
   *  Returns a Buffer slice (zero-copy view when possible). */
  encode(data: unknown): Buffer {
    const json = JSON.stringify(data);
    const needed = Buffer.byteLength(json, "utf8");
    if (needed > this.buf.length) {
      // Grow to next power-of-two above needed.
      this.buf = Buffer.allocUnsafe(Math.max(needed, this.buf.length * 2));
    }
    const written = this.buf.write(json, 0, needed, "utf8");
    return this.buf.subarray(0, written);
  }
}

// ---- Client -----------------------------------------------------------------

export class BrainClient {
  readonly baseUrl: string;
  private readonly agent: http.Agent;
  private readonly timeout: number;
  private readonly buffer: ReusableBuffer;
  private _closed = false;

  constructor(opts: BrainClientOptions = {}) {
    this.baseUrl = (
      opts.baseUrl ||
      process.env.TRINITY_BRAIN_API ||
      process.env.BRAIN_API_URL ||
      "http://localhost:8100"
    ).replace(/\/+$/, "");

    this.timeout = opts.timeoutMs ?? 30_000;

    // Single persistent socket with keep-alive.
    // maxSockets=1 means Node reuses the same TCP connection for sequential
    // requests, and queues concurrent ones (brain API is single-threaded anyway).
    this.agent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: opts.keepAliveMs ?? 60_000,
      maxSockets: opts.maxSockets ?? 2,
      maxFreeSockets: opts.maxSockets ?? 2,
      timeout: this.timeout,
    });

    this.buffer = new ReusableBuffer(opts.bufferSize ?? 256 * 1024);
  }

  // ---- Low-level request ----------------------------------------------------

  private _request<T = unknown>(
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<BrainResponse<T>> {
    return new Promise((resolve, reject) => {
      if (this._closed) {
        return reject(new Error("BrainClient is closed"));
      }

      const u = new URL(this.baseUrl + pathname);
      const payload = body !== undefined ? this.buffer.encode(body) : null;

      const req = http.request(
        {
          method,
          hostname: u.hostname,
          port: u.port || 80,
          path: u.pathname + u.search,
          agent: this.agent,
          headers: {
            Accept: "application/json",
            ...(payload
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": payload.length,
                }
              : {}),
          },
          timeout: this.timeout,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let data: T;
            try {
              data = raw ? JSON.parse(raw) : ({} as T);
            } catch {
              data = raw as unknown as T;
            }
            const ok = (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300;
            resolve({ ok, status: res.statusCode ?? 500, data });
          });
        },
      );

      req.on("error", (err) => {
        reject(new Error(`brain request ${method} ${pathname} failed: ${err.message}`));
      });

      req.on("timeout", () => {
        req.destroy(new Error(`brain request ${method} ${pathname} timed out`));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  // ---- Convenience methods --------------------------------------------------

  async get<T = unknown>(path: string): Promise<T> {
    const r = await this._request<T>("GET", path);
    if (!r.ok) throw new Error(`brain GET ${path}: ${r.status}`);
    return r.data;
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const r = await this._request<T>("POST", path, body);
    if (!r.ok) throw new Error(`brain POST ${path}: ${r.status}`);
    return r.data;
  }

  async delete<T = unknown>(path: string, body?: unknown): Promise<T> {
    const r = await this._request<T>("DELETE", path, body);
    if (!r.ok) throw new Error(`brain DELETE ${path}: ${r.status}`);
    return r.data;
  }

  // ---- Brain-specific API wrappers ------------------------------------------

  /** Health probe — lightweight, good for connection warm-up. */
  health(): Promise<{ status: string }> {
    return this.get("/health");
  }

  /** Brain status (v2). */
  status(): Promise<unknown> {
    return this.get("/v2/status");
  }

  /** Recall memories by semantic query. */
  recall(query: string, opts?: { collection?: string; top_k?: number; min_score?: number }) {
    const collection = opts?.collection ?? "memories";
    return this.post(`/v2/recall/${collection}`, {
      query,
      top_k: opts?.top_k ?? 5,
      min_score: opts?.min_score ?? 0.5,
    });
  }

  /** Ingest a memory into the brain. */
  ingest(text: string, opts?: { collection?: string; source?: string; metadata?: Record<string, unknown> }) {
    const collection = opts?.collection ?? "memories";
    return this.post(`/v2/ingest/${collection}`, { text, source: opts?.source, metadata: opts?.metadata });
  }

  /** Ingest a manual (free-form) memory. */
  ingestManual(content: string, opts?: { source?: string; domains?: string[] }) {
    return this.post("/ingest/manual", { content, source: opts?.source ?? "gateway", domains: opts?.domains });
  }

  /** Get contradictions from the brain's belief system. */
  contradictions(): Promise<unknown> {
    return this.get("/contradictions");
  }

  /** Request a graph query. */
  graphQuery(query: string) {
    return this.post("/graph/query", { query });
  }

  /** Recall skills semantically. */
  recallSkills(query: string, opts?: { top_k?: number; domain?: string; token_budget?: number }) {
    return this.post("/v2/skills/recall", {
      query,
      top_k: opts?.top_k ?? 10,
      domain: opts?.domain,
      token_budget: opts?.token_budget ?? 4000,
    });
  }

  /** Run a reflection cycle in the brain. */
  reflect(mode = "standard") {
    return this.post("/reflect/run", undefined);
  }

  /** Get the current model config. */
  modelConfig(): Promise<unknown> {
    return this.get("/v2/model/config");
  }

  // ---- Lifecycle ------------------------------------------------------------

  /** Pre-warm the persistent connection (call once at startup). */
  async warmup(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }

  /** Destroy the agent pool. Call on process exit. */
  close() {
    this._closed = true;
    this.agent.destroy();
  }

  /** Pool statistics (useful for dashboard / diagnostics). */
  stats() {
    const sockets = Object.values(this.agent.sockets).flat().length;
    const freeSockets = Object.values(this.agent.freeSockets).flat().length;
    const requests = Object.values(this.agent.requests).flat().length;
    return { sockets, freeSockets, pendingRequests: requests, baseUrl: this.baseUrl };
  }
}

// ---- Singleton --------------------------------------------------------------

let _instance: BrainClient | null = null;

/**
 * Return the singleton BrainClient.
 * The first call creates it; subsequent calls return the same instance.
 * All gateway modules should use this instead of raw fetch().
 */
export function getBrainClient(opts?: BrainClientOptions): BrainClient {
  if (!_instance) {
    _instance = new BrainClient(opts);
  }
  return _instance;
}

/**
 * Convenience alias — `import { brain } from "../brain/client.js"`.
 * Lazy-initialised on first property access.
 */
export const brain: BrainClient = new Proxy({} as BrainClient, {
  get(_target, prop) {
    const client = getBrainClient();
    const value = (client as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

export default BrainClient;
