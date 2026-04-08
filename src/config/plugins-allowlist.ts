import type { TrinityConfig } from "./config.js";

export function ensurePluginAllowlisted(cfg: TrinityConfig, pluginId: string): TrinityConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}

