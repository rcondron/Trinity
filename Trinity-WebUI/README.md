# Trinity Webapp

The Trinity Webapp is the **command and control center** for the Trinity agent.
It is a browser-based UI that walks a new user through installing Docker,
spinning up the Trinity containers, installing the Bridge, and configuring the
agent — and then becomes the day-to-day console for chatting with the agent
and managing what parts of the host it can touch.

## Architecture

```
┌────────────── Host (your computer) ──────────────────┐
│                                                      │
│   ┌──────────────┐        ┌───────────────────────┐  │
│   │  Webapp      │◀──────▶│  Trinity Bridge       │  │
│   │  (browser)   │  HTTP  │  (Node, 127.0.0.1)    │  │
│   └──────────────┘        └──────────┬────────────┘  │
│                                      │ HTTP          │
│                                      │ 18789         │
│        ┌─────────────────────────────┼──────────┐    │
│        │                             ▼          │    │
│        │  ┌──────────────┐   ┌──────────────┐   │    │
│        │  │ trinity-     │◀─▶│ trinity-     │   │    │
│        │  │  agent       │   │  brain       │   │    │
│        │  │ (container)  │   │ (container)  │   │    │
│        │  └──────────────┘   └──────────────┘   │    │
│        │              Docker network            │    │
│        └────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

- **Webapp** — static HTML/CSS/JS in this folder. Open `StartHere.html` in a
  browser. No build step, no framework.
- **Bridge** — host-side Node.js service (`bridge/bridge-server.js`). Acts as
  the security boundary: the webapp never talks to the Trinity container
  directly, and the container cannot touch the host except through the
  bridge's allow-list.
- **trinity-agent** — the Trinity agent itself, running in its own container.
- **trinity-brain** — memory / vectors / graph / reflection, in its own container.

## Files

```
webapp/
├── StartHere.html           ← Main onboarding page (open this first)
├── README.md                ← You are here
├── css/
│   └── style.css            ← Cyberpunk theme
├── js/
│   ├── matrix-rain.js       ← Background canvas effect
│   ├── bridge-client.js     ← Frontend → Bridge HTTP client
│   ├── onboarding.js        ← Step-by-step wizard
│   ├── chat.js              ← Chat UI controller
│   ├── dashboard.js         ← Command & control controller
│   └── access-control.js    ← Permission UI controller
├── pages/
│   ├── dashboard.html       ← Command & control
│   ├── chat.html            ← Chat with Trinity
│   └── access-control.html  ← Permissions / host access
├── bridge/                  ← The Bridge daemon (runs on host)
│   ├── bridge-server.js     ← HTTP server + router
│   ├── security.js          ← Permission store + decision engine
│   ├── trinity-client.js    ← Client for the trinity-agent gateway
│   ├── package.json
│   └── README.md
└── docker/
    ├── docker-compose.trinity.yml  ← trinity-agent + trinity-brain
    └── trinity-agent.env           ← agent env (no secrets)
```

## Quick start

1. **Install Docker.** See Step 3 of the onboarding wizard for per-platform
   instructions.

2. **Start the Trinity stack.** From the repo root:

   ```bash
   docker compose -f webapp/docker/docker-compose.trinity.yml up -d
   ```

3. **Start the Bridge on your host:**

   ```bash
   cd webapp/bridge
   node bridge-server.js
   ```

   The bridge prints a pairing token like `TRN-1A2B-3C4D-5E6F` on first run.

4. **Open the webapp:**

   ```bash
   # Just open the file in a browser
   open webapp/StartHere.html       # macOS
   xdg-open webapp/StartHere.html   # Linux
   start webapp\StartHere.html      # Windows
   ```

5. Walk through the 7-step onboarding wizard. In Step 5, paste the pairing
   token from the bridge console.

## How the security model works

The container is **completely isolated** from your host. There are no host
volume mounts other than a named-volume workspace, no Docker socket, no
privileged mode. All four container capabilities (`CAP_DROP: ALL`) are
dropped, and `no-new-privileges` is set.

When the Trinity agent wants to touch your host — read a file, list a folder,
run a command, fetch from a whitelisted domain — it sends an HTTP POST to
`http://host.docker.internal:4711/access` with a permission id and operation.
The Bridge:

1. Checks the pairing token.
2. Looks up the permission by id.
3. Verifies the permission is enabled.
4. Verifies the requested path/host is **inside** the permission's root.
5. Verifies the op matches the permission's mode (`write` requires `rw`).
6. Executes the action and writes an entry to the audit log.

Anything not explicitly allow-listed is **denied**. The user manages the
allow-list from the **Access Control** page in the webapp.

## Why open `StartHere.html` directly?

Because the bridge is loopback-only and CORS-safe for `file://` and
`http://localhost` origins, you don't need to run a web server to serve the
webapp. You *can* serve it if you prefer:

```bash
cd webapp
python -m http.server 8080
# then open http://localhost:8080/StartHere.html
```
