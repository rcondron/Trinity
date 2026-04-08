# TabHR — Trinity (Docker / digital employee)

This is a **slimmed Trinity fork** for running the gateway as a **digital employee** in a Linux Docker container (e.g. for TabHR).

- **Removed:** macOS/iOS/Android apps, installers, full docs, and scripts that are only needed for native apps or full upstream CI.
- **Kept:** Core CLI, gateway, extensions, UI build, and the minimal `apps/shared/TrinityKit/Tools/CanvasA2UI` + `vendor/a2ui` needed to build the A2UI bundle.

## Quick start (Docker)

Use the full stack with native Trinity Brain:

```bash
# Build and start gateway + brain stack (Milvus, Ollama, Neo4j, brain-api)
docker compose up -d --build
```

Or see **[docs/README.md](docs/README.md)** for details on building, running, and onboarding.

The `trinity onboard` command will automatically setup the complete memory stack and ingest initial persona data.

## Build and run locally (Linux)

Requires **Node ≥22** and **pnpm**.

```bash
pnpm install
pnpm build
node Trinity.mjs gateway --allow-unconfigured
```

Configure via `Trinity onboard` or by copying an existing `~/.Trinity` (or set `Trinity_HOME`).

## Upstream

Based on [Trinity](https://github.com/Trinity/Trinity). License: MIT.



## Persona & Onboarding
All persona (SOUL, IDENTITY, USER, AGENTS) and onboarding data is now fed directly into the Trinity Brain using ingest.js. Static .md files are archival only.
