/**
 * Morpheus Gateway Init
 *
 * Called during Trinity gateway startup. If the user has configured MOR-token
 * mode (as opposed to API-key mode), this module:
 *
 *   1. Reads the Morpheus compute config from the Trinity config file.
 *   2. Connects to the Base chain via the configured RPC.
 *   3. Looks up the selected model in the on-chain ModelRegistry.
 *   4. Finds the best provider bid (by reputation score).
 *   5. Stakes MOR tokens and opens a session on-chain.
 *   6. Establishes a persistent TCP socket to the provider.
 *   7. Registers the session as a Trinity model provider so the agent
 *      can use it like any other OpenAI-compatible endpoint.
 *
 * If the user has configured API-key mode instead, this module is a no-op.
 *
 * Usage (called from gateway startup):
 *   import { initMorpheusCompute } from "./morpheus/gateway-init.js";
 *   await initMorpheusCompute(config);
 */

import { MorpheusComputeClient } from "./compute-client.js";
import { MorpheusSessionManager, type SessionHandle } from "./session-manager.js";
import { sessionToProvider, type MorpheusProviderEntry } from "./provider-adapter.js";

// ---- Types ------------------------------------------------------------------

export interface MorpheusComputeConfig {
  /** "api-key" = traditional provider key; "mor-token" = stake MOR for sessions. */
  mode: "api-key" | "mor-token";

  // ---- MOR-token mode fields ----
  /** Hex private key for the wallet holding MOR tokens. */
  privateKey?: string;
  /** Base chain RPC URL. */
  rpcUrl?: string;
  /** Use Base Sepolia testnet. */
  testnet?: boolean;
  /**
   * Models to open sessions for on startup.
   * Each entry opens a separate session with its own persistent socket.
   */
  sessions?: Array<{
    /** On-chain model ID (bytes32 hex). */
    modelId: string;
    /** Human-readable model name (for display). */
    modelName?: string;
    /** MOR tokens to stake (in wei as string). */
    stakeAmount: string;
    /** Context window size (default 4096). */
    contextTokens?: number;
  }>;
  /** Seconds before session expiry to auto-close. */
  autoCloseLeadTimeSec?: number;
}

export interface MorpheusInitResult {
  mode: "api-key" | "mor-token";
  sessions: SessionHandle[];
  providers: MorpheusProviderEntry[];
  errors: string[];
}

// ---- Singleton state --------------------------------------------------------

let _manager: MorpheusSessionManager | null = null;
let _providers: MorpheusProviderEntry[] = [];

export function getSessionManager(): MorpheusSessionManager | null {
  return _manager;
}

export function getActiveProviders(): MorpheusProviderEntry[] {
  return _providers;
}

// ---- Init -------------------------------------------------------------------

/**
 * Initialize Morpheus compute integration.
 *
 * Call this once during gateway startup. If mode is "api-key", returns
 * immediately with an empty result. If mode is "mor-token", opens sessions
 * and registers providers.
 */
export async function initMorpheusCompute(
  config: MorpheusComputeConfig,
): Promise<MorpheusInitResult> {
  const result: MorpheusInitResult = {
    mode: config.mode,
    sessions: [],
    providers: [],
    errors: [],
  };

  // API-key mode — nothing to do here. The agent uses its configured providers.
  if (config.mode !== "mor-token") {
    console.log("[Morpheus] Mode: api-key — skipping on-chain session setup.");
    return result;
  }

  if (!config.privateKey) {
    result.errors.push("MOR-token mode requires a wallet private key.");
    console.error("[Morpheus]", result.errors[0]);
    return result;
  }

  if (!config.sessions || config.sessions.length === 0) {
    result.errors.push("MOR-token mode requires at least one session config.");
    console.error("[Morpheus]", result.errors[0]);
    return result;
  }

  console.log(`[Morpheus] Mode: mor-token — opening ${config.sessions.length} session(s)…`);

  // 1. Create compute client (connects to Base chain).
  const compute = new MorpheusComputeClient({
    rpcUrl: config.rpcUrl,
    privateKey: config.privateKey,
    testnet: config.testnet,
  });

  // 2. Create session manager.
  _manager = new MorpheusSessionManager(compute, {
    autoCloseLeadTimeSec: config.autoCloseLeadTimeSec,
  });

  // Wire up logging.
  _manager.on("session:opened", (h: SessionHandle) => {
    console.log(`[Morpheus] Session opened: ${h.sessionId.slice(0, 16)}… → ${h.endpoint} (${h.modelName})`);
  });
  _manager.on("session:closed", (ev: { sessionId: string }) => {
    console.log(`[Morpheus] Session closed: ${ev.sessionId.slice(0, 16)}…`);
    // Remove the closed session's provider entry.
    _providers = _providers.filter((p) => p.sessionId !== ev.sessionId);
  });
  _manager.on("session:expiring", (ev: { sessionId: string }) => {
    console.warn(`[Morpheus] Session expiring soon: ${ev.sessionId.slice(0, 16)}…`);
  });
  _manager.on("session:error", (ev: { sessionId: string; error: unknown }) => {
    console.error(`[Morpheus] Session error: ${ev.sessionId.slice(0, 16)}…`, ev.error);
  });

  // 3. Open sessions in parallel.
  const settled = await Promise.allSettled(
    config.sessions.map(async (sc) => {
      try {
        const handle = await _manager!.openSession(
          sc.modelId,
          BigInt(sc.stakeAmount),
          { modelName: sc.modelName },
        );

        // Register as a Trinity provider.
        const entry = sessionToProvider(handle, sc.modelName, sc.contextTokens);
        _providers.push(entry);
        result.sessions.push(handle);
        result.providers.push(entry);

        console.log(
          `[Morpheus] ✓ Session ${handle.sessionId.slice(0, 12)}… ` +
          `model=${sc.modelName || sc.modelId.slice(0, 12)} ` +
          `provider=${handle.provider.slice(0, 10)}… ` +
          `endpoint=${handle.endpoint} ` +
          `expires=${new Date(handle.endsAt * 1000).toISOString()}`
        );
      } catch (e: unknown) {
        const msg = `Failed to open session for model ${sc.modelName || sc.modelId}: ${e instanceof Error ? e.message : String(e)}`;
        result.errors.push(msg);
        console.error(`[Morpheus] ✗ ${msg}`);
      }
    }),
  );

  console.log(
    `[Morpheus] Init complete: ${result.sessions.length} session(s) opened, ` +
    `${result.errors.length} error(s).`
  );

  return result;
}

/**
 * Shut down all Morpheus sessions gracefully.
 * Call during gateway shutdown.
 */
export async function shutdownMorpheusCompute(): Promise<void> {
  if (_manager) {
    console.log("[Morpheus] Shutting down sessions…");
    await _manager.closeAll();
    _manager.destroy();
    _manager = null;
    _providers = [];
    console.log("[Morpheus] Shutdown complete.");
  }
}

/**
 * Get a summary of the current Morpheus state for the dashboard.
 */
export function getMorpheusStatus() {
  if (!_manager) {
    return { initialized: false, mode: "api-key", sessions: [], providers: [] };
  }
  return {
    initialized: true,
    mode: "mor-token",
    sessions: _manager.listSessions().map((s) => ({
      sessionId: s.sessionId,
      modelId: s.modelId,
      modelName: s.modelName,
      provider: s.provider,
      endpoint: s.endpoint,
      alive: s.alive,
      openedAt: s.openedAt,
      endsAt: s.endsAt,
      requestCount: s.requestCount,
      bytesSent: s.bytesSent,
      bytesReceived: s.bytesReceived,
    })),
    providers: _providers.map((p) => ({
      providerId: p.providerId,
      sessionId: p.sessionId,
      endpoint: p.config.baseUrl,
      models: p.config.models.map((m) => m.name),
      endsAt: p.endsAt,
    })),
    stats: _manager.stats(),
  };
}
