import type { TrinityPluginApi } from "Trinity/plugin-sdk";
import { emptyPluginConfigSchema } from "Trinity/plugin-sdk";
import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: TrinityPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;

