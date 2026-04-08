# Serenity Phase 3 — Full Reflection Engine

**Label:** serenity-phase3  
**Date:** 2026-04-07  
**Status:** Production-ready, natively integrated into Trinity core and current OpenClaw agent.

## Overview
Serenity is the self-improvement and reflection layer. Inspired by Nous Research's Serenity (rebranded as Serenity), it enables the agent to:
- **Automatically create skills** from observed successful tool sequences.
- **Track and score performance** using multi-factor metrics (success, efficiency, consistency, adoption, contradiction rate, user-value proxy via brain recall).
- **Run self-improvement loops** via periodic `runReflectionCycle()`.
- **Detect and resolve contradictions** by querying Trinity-Brain/lex-brain API.
- **Autonomously evolve skills**: generate variants, simulate/test (via scoring + vitest patterns), promote winners to `skills/evolved/`, archive lessons in brain.
- **Closed-loop optimization**: uses RL-like rewards from scores to tune thresholds, configs, prompts; results ingested as semantic/episodic memories.

Fully **native to core** (`src/serenity/reflection-engine.ts` + lifecycle hooks in agent runtime, bootstrap, CLI). The previous `extensions/serenity/` has been deprecated and archived to `old/serenity-plugin-archive/`. No more plugin registration — wired directly like Phase 2 brain.

Consistent with **brain-native architecture**: all events (reflections, evolutions, scores, contradictions) are append-only ingested into vector DB (Milvus), entity graph, beliefs system. Uses `lex-brain/scripts/recall.js`, `/ingest`, `/contradictions`, `/reindex`.

## Key Components
- **SkillTracker**: JSON-backed rolling metrics (30d default), stats, pruning.
- **SkillCreator**: Pattern detection from session tool sequences → auto SKILL.md in `skills/auto/`.
- **InsightGenerator**: Analyzes trends, failures, recommends.
- **ReflectionEngine** (new core): Orchestrates full cycles. Includes `calculateSkillScore()`, `evolveSkill()`, `detectAndResolveContradictions()`, `runClosedLoopOptimization()`, `autonomousImprove()`.
- **Integration points**:
  - `after_tool_call` hook records metrics.
  - Session end / cron / heartbeat triggers full reflection.
  - Onboarding runs initial baseline reflection.
  - CLI commands trigger manual cycles.

## How Closed-Loop Works
1. Tool calls → metrics recorded + mini-reflections on anomalies.
2. Reflection cycle (daily or on-demand):
   - Pull recent metrics + brain recall for context.
   - Detect contradictions → resolve via reindex/ingest.
   - Create new auto-skills from high-success patterns.
   - For top skills: compute score, evolve (generate variant code/prompts), test score, promote if >5% better.
   - Optimize system params (e.g. success thresholds, retention) based on aggregate scores/insights.
   - Ingest all outcomes to brain (episodic for cycles, semantic for lessons, beliefs for updated params).
3. Evolution history tracked in `.serenity/evolution-history.json` + brain.
4. Scores feed back into future pattern detection and prioritization.

**Scoring Formula** (multi-factor, 0-100):
```
overall = (success*30 + efficiency*20 + adoption*15 + consistency*15 + userValue*10 + evolutionPotential*10)
```
Efficiency inversely proportional to duration; consistency from contradiction logs; userValue from brain semantic recall of positive outcomes.

## CLI Updates
- `trinity serenity reflect [--full]` : Run full reflection cycle.
- `trinity serenity evolve <skill>` : Target specific skill for evolution.
- `trinity serenity optimize` : Run closed-loop param tuning only.
- `trinity serenity status` : Dashboard of scores, evolutions, contradictions, brain health.
- Updated `trinity onboard` now includes Serenity init + baseline ingest.
- `trinity skills` enhanced to show auto/evolved/Serenity-scored skills.

## Bootstrap & Onboarding Updates
- `trinity onboard` (and equivalent in current agent): 
  - Starts brain stack (if not running).
  - Ingests SOUL/USER/AGENTS into brain.
  - Initializes `.serenity/` dirs and config.
  - Runs initial `autonomousImprove()` to baseline skills from existing metrics.
  - Updates MEMORY.md and daily notes with Serenity activation.
- Config extended with `Serenity: { enabled: true, native: true, reflectionIntervalHours: 6, ... }`.
- All updated in `src/cli/`, bootstrap scripts, docker-compose.

## Applied to Current Agent (OpenClaw workspace)
- Added `skills/serenity/` mirroring core logic (JS version for lex-brain compatibility).
- Updated `AGENTS.md`, `MEMORY.md`, `lex-brain/scripts/` with reflection hooks.
- `trinity-brain-migration.ps1` enhanced to include Serenity data migration.
- Daily memory/2026-04-07.md logs the implementation.
- Uses existing lex-brain for contradictions, recall of past sessions via `search-transcripts.js`.
- Core tools (read/write/edit/exec etc.) now report to ReflectionEngine via session hooks.

## Production Notes
- **Error resilient**: Falls back gracefully if brain-api unavailable.
- **Observable**: All actions logged to brain for `recall "Serenity reflection"`.
- **Tested**: Compatible with vitest configs; evolution uses simulated scoring (extendable to real sandboxed evals).
- **Scalable**: Rolling windows prevent bloat; compression via brain's compress endpoint.
- **Security**: No self-modification of core code without human review (skills go to auto/evolved dirs; core updates via PR-like ingest).
- **Monitoring**: `Serenity status` shows evolution trend; contradictions trigger alerts.

## Phase 4 Integration (trinity-phase4)
Serenity ReflectionEngine has been fully extended with RL optimizer, orchestration hooks, user modeling integration, self-replication logic, and system-level evolution capabilities. Now part of the unified Trinity autonomy layer. See TRINITY-PHASE4.md and updated MORPHEUS-PLAN.md.

**Future:** Publish as open framework; continue RL improvements with real user feedback loops. All complete and productionized as of 2026-04-07.

**Summary of what was built**: A complete, closed-loop self-improving reflection system that turns usage data + brain memory into new capabilities autonomously, while detecting issues and optimizing itself. Integrated everywhere, documented, labeled 'serenity-phase3'. The agent (both instances) can now generate, test, score, and improve its own skills over time.

See `src/serenity/reflection-engine.ts` for implementation details. Run `trinity serenity status` or equivalent to verify.

*Renamed and updated as part of serenity-rename task by subagent:575b58a9-d6c1-4951-bae2-c0455b0ed1d9.*




