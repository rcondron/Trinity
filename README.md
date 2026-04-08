# Trinity-Test — AI Agent for the Morpheus Network

This is an AI Agent for the [Morpheus Network](https://mor.org), a decentralized infrastructure for autonomous AI agents, compute, and intelligence. It leverages the Trinity framework for multi-agent orchestration, memory (Lex-Brain), tools, and self-improving capabilities (Serenity/Trinity phases).

## Key Features
- **Autonomous Agents**: Multi-agent orchestration with RL-driven optimization and safe self-replication.
- **Memory System**: Lex-Brain with semantic/episodic memory, vector search (Milvus), and reflection engine for self-improvement.
- **Tools & Browser Automation**: Integrated tools for web, code, calendar, email, and browser control.
- **Morpheus Integration**: Designed to operate within the Morpheus ecosystem for decentralized AI tasks, agent coordination, and network participation.

## Quick Start

```bash
# Setup (repo already cloned and populated)
cd D:\Trinity-Test
pnpm install
pnpm build
node Trinity.mjs gateway --allow-unconfigured
```

Run `trinity onboard` or configure via environment variables for Morpheus-specific settings.

See the full documentation in `docs/` for advanced setup, agent spawning, and Morpheus network integration.

## Research Summary on Morpheus (mor.org)
Morpheus is a decentralized AI network focused on:
- Autonomous AI agents that can operate independently on the blockchain.
- Decentralized compute resources for AI inference and training.
- Tokenized economy for agents, developers, and compute providers.
- Integration with Fetch.ai, SingularityNET, and other AI projects in the ASI Alliance.
- Emphasis on agent-to-agent communication, smart contracts for AI tasks, and open-source agent frameworks.

This project serves as a testbed and reference implementation for running Trinity-based agents on the Morpheus network.

## License
MIT (based on upstream Trinity).

## Upstream
Based on the Trinity AI framework with custom modifications for Morpheus compatibility.