# Trinity in Docker

This fork is trimmed to run **Trinity as a digital employee** in a Linux Docker
container, wired up for the Morpheus Network.

## Build the image

**Requirements:** Node 22+, pnpm. For the A2UI bundle build you need either:

- The `vendor/a2ui` tree (copy from upstream Trinity or ensure it exists before build), or
- A pre-built `src/canvas-host/a2ui/a2ui.bundle.js` (build once from a full Trinity clone, then copy here).

```bash
pnpm install
pnpm build
docker build -t trinity .
```

## Run the gateway

Default command runs the gateway bound to loopback:

```bash
docker run -d --name trinity-gateway -p 18789:18789 trinity
```

For LAN or external access (e.g. health checks), override the command:

```bash
docker run -d --name trinity-gateway -p 18789:18789 \
  -e Trinity_GATEWAY_TOKEN=your-token \
  trinity \
  node Trinity.mjs gateway --allow-unconfigured --bind lan
```

## Configure

- Config and state live in `~/.Trinity` (or `Trinity_HOME`). Mount a volume to persist:
  ```bash
  docker run -d -p 18789:18789 -v trinity-data:/home/node/.Trinity trinity
  ```
- First-time setup: open `webapp/StartHere.html` for the onboarding wizard, or
  copy an existing `~/.Trinity` from another Trinity install.

This fork has no web Control UI; the gateway runs headless. Use the CLI
(`Trinity` commands), the webapp in `webapp/`, or your channels to interact
with the digital employee.

**Browser:** The default browser profile `chrome` connects to an external
browser extension at `http://127.0.0.1:9220`. The extension uses a JSON
envelope API (not CDP): the gateway sends commands like
`{ "requestId", "endpoint", ...params }` (e.g. `status`, `navigate`, `click`,
`type`, `screenshot`, `evaluate`) and receives
`{ "success", "data" | "error", "requestId" }`. Ensure the extension is
running on that port. Use `Trinity browser extension url` to print the URL.
