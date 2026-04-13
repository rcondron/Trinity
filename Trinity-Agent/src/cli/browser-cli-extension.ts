import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { copyToClipboard } from "../infra/clipboard.js";
import { info } from "../globals.js";
import { BROWSER_EXT_PORT } from "../config/port-defaults.js";

/** Browser extension URL (JSON envelope API exposed directly on this port). */
export const BROWSER_EXT_URL = `http://127.0.0.1:${BROWSER_EXT_PORT}`;

export function registerBrowserExtensionCommands(
  browser: Command,
  parentOpts: (cmd: Command) => { json?: boolean },
) {
  const ext = browser
    .command("extension")
    .description("Browser extension (JSON envelope API on port 9220)");

  ext
    .command("url")
    .description("Print the browser extension URL (default profile uses this)")
    .action(async (_opts, cmd) => {
      const parent = parentOpts(cmd);
      if (parent?.json) {
        defaultRuntime.log(JSON.stringify({ url: BROWSER_EXT_URL, port: BROWSER_EXT_PORT }, null, 2));
        return;
      }
      defaultRuntime.log(BROWSER_EXT_URL);
      const copied = await Promise.resolve(copyToClipboard(BROWSER_EXT_URL)).catch(() => false);
      if (copied) {
        defaultRuntime.error(info("Copied to clipboard."));
      }
    });

  ext
    .command("info")
    .description("Show browser extension connection info")
    .action(async (_opts, cmd) => {
      const parent = parentOpts(cmd);
      if (parent?.json) {
        defaultRuntime.log(
          JSON.stringify(
            {
              url: BROWSER_EXT_URL,
              port: BROWSER_EXT_PORT,
              profile: "chrome",
              note: "Default browser profile 'chrome' uses this URL. Ensure the browser extension (or a browser with --remote-debugging-port=9220) is running.",
            },
            null,
            2,
          ),
        );
        return;
      }
      defaultRuntime.error(
        info(
          [
            `${theme.muted("Browser extension")} URL: ${BROWSER_EXT_URL}`,
            `Profile "chrome" uses this URL. Ensure the browser extension is running on port ${BROWSER_EXT_PORT}.`,
          ].join("\n"),
        ),
      );
    });
}
