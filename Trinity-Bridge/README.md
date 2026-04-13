# Trinity Bridge

The **Trinity Bridge** is the host-side gatekeeper between the Trinity Docker
container (and the Trinity webapp) and the rest of your computer. It is the
single security boundary through which the agent is permitted to touch your
filesystem, run commands, or reach devices.

```
┌────────────────── Host (your computer) ──────────────────┐
│                                                          │
│  Trinity Webapp ──▶ Trinity Bridge ◀── Trinity Container │
│   (browser)       (Node on host)          (docker)       │
│                         │                                │
│                         ▼                                │
│                 Host resources                           │
│                 (fs, processes,                          │
│                  devices, network)                       │
└──────────────────────────────────────────────────────────┘
```

## Why a bridge?

Running the agent as a container is only useful if the container stays
contained. Mounting `/`, the Docker socket, or `--privileged` defeats the
point. The bridge gives the container (and the webapp) a narrow, audited
allow-list API so the agent has to ask permission for every host touch.

## Install & run

```bash
cd webapp/bridge
npm install      # no runtime deps — this just creates node_modules/
node bridge-server.js
```

The bridge listens on `http://127.0.0.1:4711` (loopback only). On first run it
prints a **pairing token** to the console — paste this into the webapp
onboarding wizard (Step 5) to authorise the webapp.

Run it in the background:

```bash
node bridge-server.js --daemon
```

Or install as a system service with your preferred init system (systemd,
launchd, Windows Services).

## Configuration

All state lives under `~/.trinity-bridge/`:

| File              | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `config.json`     | Host, port, Trinity container URL            |
| `pairing-token`   | One-time token used to pair the webapp       |
| `permissions.json`| The allow-list used for `/access` calls      |
| `audit.log`       | Append-only log of every bridge action       |

Defaults:

```json
{
  "host": "127.0.0.1",
  "port": 4711,
  "trinityContainerUrl": "http://127.0.0.1:18789",
  "allowedOrigins": ["http://127.0.0.1", "http://localhost", "file://", "null"]
}
```

## API

| Method | Path                  | Auth | Description                                    |
| ------ | --------------------- | ---- | ---------------------------------------------- |
| GET    | `/health`             | No   | Liveness probe                                 |
| GET    | `/status`             | No   | Version, trinity URL, perm count               |
| POST   | `/pair`               | No   | Exchange pairing token for session             |
| GET    | `/docker/status`      | Yes  | Runs `docker --version`                        |
| GET    | `/containers`         | Yes  | Lists running containers via `docker ps`       |
| POST   | `/chat`               | Yes  | Relays a prompt to the trinity-agent container |
| GET    | `/chat/history`       | Yes  | Returns in-memory conversation                 |
| GET    | `/permissions`        | Yes  | Lists configured permissions                   |
| POST   | `/permissions`        | Yes  | Adds a new permission                          |
| DELETE | `/permissions/:id`    | Yes  | Removes a permission                           |
| PATCH  | `/permissions/:id`    | Yes  | Enables / disables a permission                |
| POST   | `/access`             | Yes  | Executes a host action against a permission    |
| GET    | `/log`                | Yes  | Last N audit entries                           |
| POST   | `/config`             | Yes  | Persist agent config                           |
| GET    | `/config`             | Yes  | Read agent config                              |
| POST   | `/agent/{start,stop,restart}` | Yes | `docker compose` the Trinity stack    |

Authenticated requests must include the pairing token as
`X-Trinity-Token: TRN-xxxx-xxxx-xxxx`.

## Permission model

Every permission is an object:

```json
{
  "id": "perm_3f2a…",
  "kind": "fs | exec | net | device",
  "name": "Project workspace",
  "path": "/absolute/path",
  "mode": "ro | rw | exec",
  "enabled": true
}
```

When the Trinity container wants to touch the host it POSTs to `/access`:

```json
POST /access
X-Trinity-Token: TRN-...
{
  "permId": "perm_3f2a…",
  "op": "read",
  "path": "/absolute/path/file.txt"
}
```

The bridge:

1. Resolves the permission by id.
2. Verifies the permission is **enabled**.
3. Verifies the requested path is **inside** the permission's root.
4. Verifies the op matches the permission's mode (e.g. `write` requires `rw`).
5. Executes the action and returns the result.
6. Writes an entry to the audit log.

Anything not explicitly allow-listed is denied.

## Zero dependencies

The bridge uses only Node core modules (`http`, `fs`, `crypto`, `child_process`).
This makes it auditable and trivial to ship.
