import type { TrinityConfig } from "../config/config.js";

export function applyOnboardingLocalWorkspaceConfig(
  baseConfig: TrinityConfig,
  workspaceDir: string,
): TrinityConfig {
  return {
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
  };
}

