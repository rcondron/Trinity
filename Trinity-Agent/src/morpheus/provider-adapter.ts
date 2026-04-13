/**
 * Morpheus Provider Adapter
 *
 * Converts an active Morpheus compute session into a Trinity model-provider
 * config entry so the agent can use it like any other OpenAI-compatible provider.
 *
 * Morpheus providers expose /v1/chat/completions on their endpoint, which
 * maps directly to the "openai-completions" API type in Trinity's model system.
 * This means zero changes to the core LLM call path — we just register a new
 * provider pointing at the session's endpoint and the existing streamSimple()
 * machinery handles the rest.
 */

import type { SessionHandle } from "./session-manager.js";

/**
 * A provider config entry compatible with Trinity's ModelsConfig.providers.
 * Injected into models.json or the runtime config so the agent treats it
 * like any other provider.
 */
export interface MorpheusProviderEntry {
  /** Provider key for Trinity's model system (e.g. "morpheus-qwen2.5"). */
  providerId: string;
  /** Full config block, ready to merge into ModelsConfig.providers. */
  config: {
    baseUrl: string;
    api: "openai-completions";
    auth: "none";
    models: Array<{
      id: string;
      name: string;
      contextTokens: number;
    }>;
  };
  /** Session metadata for display/tracking. */
  sessionId: string;
  providerAddress: string;
  stakeAmount: string;
  endsAt: number;
}

/**
 * Build a Trinity-compatible provider config from a Morpheus session.
 *
 * @param handle   Active session handle from the SessionManager.
 * @param modelName  Human-readable model name (e.g. "qwen2.5:7b").
 * @param contextTokens  Context window size (default 4096).
 */
export function sessionToProvider(
  handle: SessionHandle,
  modelName?: string,
  contextTokens = 4096,
): MorpheusProviderEntry {
  const name = modelName || handle.modelName || handle.modelId.slice(0, 16);
  // Provider ID: "morpheus-<model>" so it's unique in Trinity's provider map.
  const providerId = `morpheus-${name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase()}`;

  return {
    providerId,
    config: {
      baseUrl: handle.endpoint,
      api: "openai-completions",
      auth: "none",        // No API key — the session's staked MOR is the auth.
      models: [
        {
          id: name,
          name: `Morpheus: ${name}`,
          contextTokens,
        },
      ],
    },
    sessionId: handle.sessionId,
    providerAddress: handle.provider,
    stakeAmount: handle.stakeAmount.toString(),
    endsAt: handle.endsAt,
  };
}

/**
 * Merge Morpheus provider entries into an existing models config object.
 * Non-destructive: only adds/updates morpheus-* providers.
 */
export function mergeProviders(
  existing: Record<string, unknown>,
  entries: MorpheusProviderEntry[],
): Record<string, unknown> {
  const merged = { ...existing };
  for (const entry of entries) {
    merged[entry.providerId] = entry.config;
  }
  return merged;
}
