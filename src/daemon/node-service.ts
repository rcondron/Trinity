import {
  NODE_SERVICE_KIND,
  NODE_SERVICE_MARKER,
  NODE_WINDOWS_TASK_SCRIPT_NAME,
  resolveNodeLaunchAgentLabel,
  resolveNodeSystemdServiceName,
  resolveNodeWindowsTaskName,
} from "./constants.js";
import type { GatewayService, GatewayServiceInstallArgs } from "./service.js";
import { resolveGatewayService } from "./service.js";

function withNodeServiceEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    Trinity_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
    Trinity_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
    Trinity_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
    Trinity_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    Trinity_LOG_PREFIX: "node",
    Trinity_SERVICE_MARKER: NODE_SERVICE_MARKER,
    Trinity_SERVICE_KIND: NODE_SERVICE_KIND,
  };
}

function withNodeInstallEnv(args: GatewayServiceInstallArgs): GatewayServiceInstallArgs {
  return {
    ...args,
    env: withNodeServiceEnv(args.env),
    environment: {
      ...args.environment,
      Trinity_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
      Trinity_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
      Trinity_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
      Trinity_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
      Trinity_LOG_PREFIX: "node",
      Trinity_SERVICE_MARKER: NODE_SERVICE_MARKER,
      Trinity_SERVICE_KIND: NODE_SERVICE_KIND,
    },
  };
}

export function resolveNodeService(): GatewayService {
  const base = resolveGatewayService();
  return {
    ...base,
    install: async (args) => {
      return base.install(withNodeInstallEnv(args));
    },
    uninstall: async (args) => {
      return base.uninstall({ ...args, env: withNodeServiceEnv(args.env) });
    },
    stop: async (args) => {
      return base.stop({ ...args, env: withNodeServiceEnv(args.env ?? {}) });
    },
    restart: async (args) => {
      return base.restart({ ...args, env: withNodeServiceEnv(args.env ?? {}) });
    },
    isLoaded: async (args) => {
      return base.isLoaded({ env: withNodeServiceEnv(args.env ?? {}) });
    },
    readCommand: (env) => base.readCommand(withNodeServiceEnv(env)),
    readRuntime: (env) => base.readRuntime(withNodeServiceEnv(env)),
  };
}

