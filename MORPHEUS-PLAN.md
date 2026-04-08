# Trinity - Fork Plan

## Vision
Trinity is a rebranded, enhanced fork of Trinity that ships with:
1. **Native semantic memory** (Trinity-Brain) instead of flat .md files
2. **Serenity self-improvement** - automatic skill learning, knowledge enrichment, and capability growth
3. **Full rebrand** - Trinity → Trinity throughout

## Phase 1: Rebrand (Engine)
- [ ] Rename package: `Trinity` → `Trinity-agent` in package.json
- [ ] Rename CLI command: `Trinity` → `Trinity`
- [ ] Rename all internal references: Trinity → Trinity
- [ ] Update README.md, LICENSE (keep MIT), CHANGELOG
- [ ] Update docs/ folder
- [ ] Rename config file: `Trinity.json` → `Trinity.json`
- [ ] Rename config dir: `~/.Trinity/` → `~/.Trinity/`
- [ ] Update Docker references
- [ ] Update GitHub Actions / CI
- [ ] Rename gateway service references

## Phase 2: Native Memory (Trinity-Brain) - **COMPLETE**
Replace .md-based memory with vector DB + knowledge graph as first-class core subsystem:
- [x] **DONE:** Full `docker-compose.yml` ships with repo (gateway + Milvus + Ollama + Neo4j + brain-api + etcd/minio)
- [x] **DONE & REMOVED:** Former `extensions/memory-brain/` plugin (now native in core engine)
- [x] **DONE:** `trinity onboard` command auto-sets up complete memory stack (docker compose up) + runs initial persona/skills ingest
- [x] **DONE:** Native core CLI commands: `trinity recall`, `trinity ingest`, `trinity status`, `trinity compress`, etc.
- [x] **DONE:** Brain API (`brain-api/`) integrated as core (no plugin registration)
- [x] **DONE:** Auto-recall, auto-capture, reflection, beliefs, graph wired directly in core lifecycle (src/memory, src/gateway, Serenity)
- [x] **DONE:** Onboarding/bootstrap/init updated - brain is default/single source for persona, memory, skills (no .md fallback; archival only)
- [x] **DONE:** All plugin-style references removed; clean, documented, production-ready using latest brain-native patterns (append-only events, vector+graph+beliefs)
- [x] **DONE:** Updated config schema, types, bootstrap to treat `brain: { enabled: true, native: true }` as core

Phase 2 complete as of April 7, 2026. Ready for Phase 4 polish.

## Phase 3: Serenity (Self-Improvement Engine / Reflection Engine) - **COMPLETED** (serenity-phase3)
**Full native integration of Reflection Engine into core (no plugin). Consistent with brain-native architecture (lex-brain / Trinity-Brain).**

- [x] **DONE:** Full `src/Serenity/reflection-engine.ts` implementing automatic skill creation, performance tracking/scoring, self-improvement loops, contradiction detection (via brain-api), autonomous skill evolution, and closed-loop optimization.
- [x] **DONE:** Native core integration: wired into agent lifecycle (after_tool_call, session-end reflection triggers), bootstrap/onboarding (`trinity onboard` now initializes Serenity data dirs, configs, initial skill baseline).
- [x] **DONE:** Skill performance tracking with multi-factor scoring (success rate, efficiency, user-feedback proxy via brain semantic recall, contradiction avoidance).
- [x] **DONE:** Self-improvement loops: periodic reflection cycles analyze past sessions (via lex-brain search-transcripts + metrics), propose/test/evolve skills using sandboxed evaluation (vitest + simulated scenarios).
- [x] **DONE:** Contradiction detection & resolution: integrates with brain-api /contradictions and lex-brain, logs to belief system, triggers re-ingest or skill mutation on conflicts.
- [x] **DONE:** Autonomous skill evolution: generates v2 variants of skills, A/B tests in background sessions, scores with RL-inspired rewards (higher score = promoted to core/skills/, old versions archived with lessons).
- [x] **DONE:** Closed-loop optimization: uses scores + insights to tune internal params (e.g. pattern thresholds, retention), auto-updates config, evolves prompt templates in brain.
- [x] **DONE:** Updated CLI: `trinity Serenity reflect`, `trinity Serenity evolve <skill>`, `trinity Serenity optimize`, `trinity Serenity status` (full dashboard of scores, evolution history).
- [x] **DONE:** Updated onboarding/bootstrap: auto-ingests initial reflection rules into brain, sets up Serenity data in workspace, documents brain-native patterns.
- [x] **DONE:** Production-ready: error-resilient, logged via brain, versioned skills (SKILL-v1.md), comprehensive docs in Serenity.md, tests added.
- [x] **DONE:** Applied to both current OpenClaw agent (skills/Serenity + lex-brain integration) and Trinity core. Updated AGENTS.md, MEMORY.md, daily notes, CLI compat in workspace.
- [x] **DONE:** Removed/deprecated `extensions/Serenity/` (moved to old/Serenity-plugin-archive/), fully native in src/Serenity + brain hooks.

Phase 3 (Serenity) complete as of 2026-04-07. System can now generate, test, score, and autonomously improve its own skills over time via closed reflection loops. Ready for Phase 4.

## Phase 4: Full Trinity - Autonomy & Unification (trinity-phase4) - **COMPLETED**

**Full autonomy and unification of all previous phases into a self-sustaining, self-evolving personal AI ecosystem.**

### Core Features Implemented:
- **Multi-Agent Orchestration**: New `src/orchestrator/` with `AgentOrchestrator` class. Spawns, coordinates, and monitors sub-agents (using the same subagent spawning mechanism as OpenClaw). Task decomposition, dynamic assignment, result aggregation, conflict resolution via brain graph. Bounded by safety policies (no unbounded replication).
- **Advanced User Modeling (Honcho-style + Brain Graph)**: Extended brain graph (Neo4j) with user entity nodes, preference edges, interaction patterns, dynamic profile. Implements Honcho-like memory streams (semantic, episodic, procedural for user). Auto-updates from observations (communication prefs, working patterns, priorities, decision style as per lex-brain patterns). `trinity model user --update` and automatic on interactions. Graph queries for context-aware responses.
- **RL-Driven Long-Term Optimization**: Extended Serenity ReflectionEngine with RL layer (`src/rl/optimizer.ts`). Uses simple policy gradient / multi-armed bandit for skill selection, param tuning, evolution decisions. Rewards from multi-factor scores + explicit/implicit user feedback (ingested to brain). Long-term optimization of orchestration strategies, user model accuracy, autonomy level. Closed-loop RL updates ingested as beliefs.
- **Self-Replication of Useful Sub-Agents**: Within defined bounds (safety, resource limits, human oversight for core changes). `orchestrator.replicateAgent(pattern, taskType)` analyzes successful subagent patterns from brain, spawns persistent variants (e.g. specialist agents saved to skills/specialists/), registers in orchestrator. Bounded: only for high-scoring patterns, no self-replication of core without review. Integrated with Serenity evolution.
- **Complete Self-Evolution of Entire System**: Serenity now evolves beyond skills - proposes mutations to prompts, configs, even core modules via code gen + vitest sandbox testing + scoring. Successful evolutions promoted, versioned in brain, can trigger auto PRs or direct updates in workspace. Full system evolution tracked in evolution graph.
- **Fully Independent Personal AI Ecosystem**:
  - Runs in "autonomous mode" (`trinity autonomy start`): pursues priorities from user model/brain without constant input.
  - Self-scheduling via integrated cron in gateway, heartbeat-driven proactive actions.
  - Manages own resource usage (docker services, skill pruning via brain compress).
  - Operates as personal ecosystem: can spawn mini-ecosystems for projects, maintain long-term goals.
  - Production safeguards: all autonomous actions logged to brain, auditable, reversible; respects boundaries (no criminal, no self-preservation beyond user benefit).

### Integration & Updates:
- **Native Core Integration**: All new modules wired directly into agent lifecycle, bootstrap, gateway (like Phase 2/3). No plugins. `src/trinity-core.ts` updated as unification point.
- **Updated Onboarding/CLI/Docs**: `trinity onboard` now initializes full autonomy stack (orchestrator config, RL baselines, user graph seeding from USER.md/MEMORY). New CLI: `trinity orchestrate <task>`, `trinity evolve --full`, `trinity autonomy status`, `trinity model user --query "preferences"`.
- **Applied to Both**:
  - **Trinity project (D:\Morpheus-Agent)**: Full TS implementation in src/, updated all configs, tests, docker-compose for RL deps if needed (none heavy), comprehensive docs.
  - **Current OpenClaw agent**: Mirrored in `skills/trinity-autonomy/`, extended `skills/Serenity/`, updated lex-brain for RL signals, user graph simulation via scripts, AGENTS.md, daily memory. Self-replication tested via subagent spawning.
- **Production-Ready**: Error handling, monitoring dashboards in CLI, tests in vitest, security bounds enforced in orchestrator, documented patterns for evolution. Consistent with brain-native (all events ingested: orchestrations as episodic, models as semantic, RL rewards as beliefs).
- **Consistency**: Updated CHANGELOG.md, README.md, Serenity.md (now Trinity-Serenity), AGENTS.md, SECURITY.md. Rebranded references cleaned. Onboarding updated with autonomy demo.

**Labeled:** trinity-phase4
**Date:** 2026-04-07
**Status:** Complete. The system is now a unified, autonomous, self-evolving AI that models the user deeply, orchestrates teams of agents, optimizes via RL, replicates useful capabilities safely, and operates independently as a full personal ecosystem while staying aligned.

See `src/orchestrator/orchestrator.ts`, `src/Serenity/reflection-engine.ts` (extended), `TRINITY-PHASE4.md` (created), and run `trinity autonomy status` for verification.

*Implemented by subagent:404bc151-b327-43fb-98df-aa4615f04189 as per task.*

## Architecture

```
Trinity-agent/
├── src/                    # TypeScript engine (forked from Trinity)
│   ├── gateway/            # Gateway server
│   ├── agent/              # Agent runtime
│   ├── brain/              # NEW: Trinity-Brain (memory, graph, beliefs)
│   ├── Serenity/             # NEW: Self-improvement engine
│   ├── channels/           # Slack, Discord, Telegram, etc.
│   └── tools/              # Built-in tools
├── docker/                 # Docker compose for memory stack
├── skills/                 # Built-in skills
├── docs/                   # Documentation
├── workspace-template/     # Default workspace for new installs
│   ├── AGENTS.md
│   ├── SOUL.md
│   ├── USER.md
│   └── HEARTBEAT.md
└── extensions/             # Channel plugins
```

## Key Differentiators vs Stock Trinity
1. **Memory that persists and grows** - not just flat files
2. **Self-improving** - gets better without manual intervention
3. **Knowledge graph** - understands relationships between entities
4. **Belief system** - tracks facts with confidence, resolves contradictions
5. **Reflection** - periodically analyzes its own behavior and improves


