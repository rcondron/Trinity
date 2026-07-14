# Trinity — Decentralized AI Agent for the Morpheus Network

An autonomous AI agent that runs in Docker, communicates through a host-side
security bridge, and can stake MOR tokens on the Morpheus compute marketplace
for decentralized LLM access.

## Project Structure

```
Trinity-Test/
├── StartHere.html              Entry point — open this in a browser
├── README.md                   This file
│
├── Trinity-Agent/              The AI agent (Node.js / TypeScript)
│   ├── src/                    Core source: gateway, CLI, tools, plugins
│   ├── extensions/             39 plugin extensions (Slack, Discord, etc.)
│   ├── scripts/                Build and dev scripts
│   ├── Dockerfile              Agent container image
│   ├── docker-compose.yml      Full stack (agent + brain + memory backends)
│   ├── package.json            Dependencies and build config
│   └── morpheus.mjs            Production entrypoint
│
├── Trinity-Brain/              Memory service (Python / FastAPI)
│   ├── main.py                 API server (ingest, recall, skills, graph, beliefs)
│   ├── embedding.py            Embedding generation (Ollama or llama.cpp)
│   ├── ner.py                  Named entity recognition
│   ├── reflection_engine.py    Self-improvement: semantic extraction, beliefs, insights
│   ├── Dockerfile              Brain container image
│   └── requirements.txt        Python dependencies
│
├── Trinity-Bridge/             Host-side security gatekeeper (Go + Node.js)
│   ├── cmd/bridge/             Go implementation (single binary, recommended)
│   ├── internal/               Go packages: api, gateway, security, audit
│   ├── bridge-server.js        Node.js implementation (legacy/reference)
│   └── go.mod                  Go module definition
│
├── Trinity-App/                Desktop application + installers
│   ├── cmd/app/                Go tray app (spawns bridge, opens webview)
│   ├── internal/tray/          Platform-native tray (Win32, Cocoa, Linux)
│   ├── installer/trinity.iss   Inno Setup script → TrinitySetup.exe
│   └── scripts/
│       ├── build-windows.ps1   Windows build → TrinitySetup.exe
│       ├── create-dmg.sh       macOS build → Trinity.dmg
│       └── install-linux.sh    Linux install + systemd service
│
├── Trinity-Avatar/             Interactive 3D avatar (voice, face, body motion)
│   ├── packages/               protocol (JSON Schema) + avatar-core (VRM, visemes,
│   │                           emotions, retargeting, micro-life)
│   ├── apps/                   web (primary), desktop-overlay (walks on your
│   │                           screen), mobile (Capacitor)
│   ├── services/               orchestrator (voice/brain pipeline, talks to the
│   │                           Bridge) + motion-service (NVIDIA ARDY / clips)
│   └── docs/                   architecture, ADRs, per-platform guides
│
├── Trinity-WebUI/              Browser interface (static HTML/CSS/JS)
│   ├── Setup.html              Onboarding wizard (8 steps)
│   ├── pages/
│   │   ├── dashboard.html      Command & control center
│   │   ├── chat.html           Chat with Trinity
│   │   ├── settings.html       API keys, models, backup, Morpheus, wallet
│   │   ├── skills.html         Skill library (brain-backed)
│   │   └── access-control.html Host resource permissions
│   ├── css/style.css           Cyberpunk theme
│   ├── js/                     Frontend controllers
│   └── docker/                 Docker compose for the webapp stack
│
└── Trinity-Tests/              Test suite
    ├── TestSuite.html          Browser-based test runner
    ├── vitest.*.config.ts      Test configs (unit, e2e, gateway, extensions, live)
    └── src/                    Test files (mirrored from agent src/)
```

## Requirements

| Component | Minimum |
|-----------|---------|
| OS | Windows 10+, macOS 12+, Linux (kernel 5.10+) |
| Docker | Docker Engine or Docker Desktop with Compose v2 |
| RAM | 16 GB (32 GB recommended for local LLMs) |
| Disk | 40 GB free |

## Install

### Windows — TrinitySetup.exe

Download `TrinitySetup.exe` and run it. Installs to `%LOCALAPPDATA%\Programs\Trinity`
(no admin required). Adds the bridge to PATH, creates a desktop shortcut,
and launches on login.

### macOS — Trinity.dmg

Download `Trinity.dmg`, drag Trinity to Applications. The app runs as a menu bar
item, auto-starts via launchd, and opens the WebUI in your browser.

### Linux — install script

```bash
curl -fsSL https://trinity.morpheus.ai/install.sh | bash
# or manually:
cd Trinity-App/scripts && sudo ./install-linux.sh
```

Installs the Go bridge to `/usr/local/bin/`, creates a systemd service,
and starts automatically.

### From source

```bash
# Build the Go bridge:
cd Trinity-Bridge && go build -o trinity-bridge ./cmd/bridge

# Build the desktop app:
cd Trinity-App && go build -o "trinity app" ./cmd/app
```

## Quick Start

### 1. Open the onboarding wizard

```bash
# Just open in a browser:
open StartHere.html           # macOS
xdg-open StartHere.html       # Linux
start StartHere.html           # Windows
```

### 2. Or set up manually

```bash
# Start the containers
docker compose -f Trinity-WebUI/docker/docker-compose.trinity.yml up -d

# Start the Bridge (host-side)
cd Trinity-Bridge
npm install
node bridge-server.js

# Open the webapp
open Trinity-WebUI/StartHere.html
```

### 3. Chat with Trinity

Open `Trinity-WebUI/pages/chat.html` in a browser. Messages flow:

```
Browser → Bridge (HTTP) → Gateway (WebSocket RPC) → LLM Provider
```

### 4. Or talk to Trinity face to face — the 3D avatar

```bash
cd Trinity-Avatar && pnpm install && pnpm dev   # http://localhost:5173
```

A full-body 3D avatar with real-time voice, lip sync, expressions and body
language. When the Bridge is running it automatically routes conversation
through your Trinity agent; with zero configuration it runs a demo persona.
Also targets VR/AR, Looking Glass, volumetric displays, a desktop overlay
(the avatar walks around on your screen) and mobile — see
[Trinity-Avatar/README.md](Trinity-Avatar/README.md).

## Architecture

```
┌─────────── Host (your computer) ────────────────┐
│                                                  │
│  Browser (Trinity-WebUI)                         │
│       │                                          │
│       ▼ HTTP                                     │
│  Trinity-Bridge (port 4711)                      │
│       │              │                           │
│       │ WebSocket    │ HTTP                      │
│       ▼              ▼                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Trinity  │  │ Trinity  │  │ Trinity  │       │
│  │ Agent    │◀▶│ Brain    │  │ LLM     │       │
│  │ :18789   │  │ :8100    │  │ :11434  │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│           Docker network (trinity-net)           │
└──────────────────────────────────────────────────┘
```

## Morpheus Compute Integration

Trinity can stake MOR tokens on the Morpheus Diamond Proxy (Base chain) to
open compute sessions with decentralized LLM providers. Each session gets its
own persistent TCP socket.

- **API Key mode**: traditional provider + API key (Anthropic, OpenAI, etc.)
- **MOR Token mode**: stake MOR → on-chain session → persistent socket to provider

Configure in Settings → Model Access Mode.

## Security Model

The agent container is fully isolated (no host mounts, `CAP_DROP: ALL`,
`no-new-privileges`). All host access goes through the Bridge's allow-list
permission system. Every action is audit-logged.

## License

MIT
