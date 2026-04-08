import type {
  AnyAgentTool,
  TrinityPluginApi,
  TrinityPluginToolFactory,
} from "../../src/plugins/types.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default function register(api: TrinityPluginApi) {
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as TrinityPluginToolFactory,
    { optional: true },
  );
}

