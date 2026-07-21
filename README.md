# OB1 (Open Brain) — pi-Driven Edition

This is your Open Brain, powered by `pi`. This configuration turns your agent into the active maintainer of your personal infrastructure.

> **Origin:** This project is a `pi`-driven adaptation of the [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1) framework created by [Nate B. Jones](https://natesnewsletter.substack.com/).

## Why this version?
Standard OB1 setup requires manual orchestration of scripts and database migrations. This version delegates these chores to `pi`, ensuring that your brain stays organized, documented, and operational with minimal friction. This system is designed to be model-agnostic, leveraging `pi` as your primary orchestrator regardless of the underlying LLM provider.

## How to use your pi-agent
Instead of running manual commands, interact with `pi` to manage your brain.

### Common Commands
- **"Search my notes for [topic]"** — Uses semantic search and optionally expands results via the knowledge graph.
- **"Answer [question] using my notes"** — Synthesizes a grounded answer from the knowledge graph, wiki synthesis pages, and accumulated learnings.
- **"Accumulate recent learnings"** — Synthesizes cross-domain insights from your recent interaction history.
- **"Audit my current extensions."** — `pi` will scan your configuration and report on status and health.

## Project Structure
- `/packages`: Reusable system components.
  - `open-brain-core`: Shared retrieval, context assembly, and LLM health/circuit breaker.
  - `open-brain-cli`: User-facing binary (`brain query`, etc.).
  - `pi-obsidian-listener`: Local-first Obsidian vault watcher.
  - `pi-open-brain`: Distributable pi extension.
- `/recipes`: Task-specific automations and workflows (Wiki builder, Graph extractors, Smoke tests).
- `/schemas`: Canonical Supabase definitions.
- `/supabase`: Edge functions and migration SQL.

## Verifying System Health
To ensure your Open Brain configuration is healthy and fully connected, run the smoke test harness:

```bash
node recipes/brain-smoke-test/smoke-all.js
```

This harness probes every live surface (DB, Auth, MCP) and reports on the system's status. For a more detailed breakdown of results and options (like destructive testing), see `recipes/brain-smoke-test/README.md`.

## 🧠 Agent Operational Knowledge Base
For technical deep-dives, configuration validation, and API troubleshooting (especially regarding LLM/API keys), please refer to the detailed operational guidelines located at: `recipes/LLM_Configuration_Insights.md`

### Architecture: Monorepo Workspaces

This project is organized as a workspace monorepo to isolate core logic from distribution-specific shims.

- **`packages/open-brain-core`** — The engine. Contains `lib/context-assembler.js` (retrieval pipeline) and `lib/llm-health.js` (circuit breaker). All other components import from this package.
- **`packages/open-brain-cli`** — The interface. Provides the `brain` binary.
- **`packages/pi-obsidian-listener`** — The ingest watcher. Monitors Obsidian vaults for changes.
- **`packages/pi-open-brain`** — The distribution. Self-contained pi extension that connects to the deployed Open Brain endpoint.
- **`recipes/`** — Standalone tasks (e.g., wiki-builder, graph-extractors) that use `open-brain-core` as a dependency.

---

## 📋 Roadmap & History

- **Phase D — Accumulated Learnings:** `learnings` + `query_sessions`, accumulator job, MCP exposure. ✅
- **Phase E — Inference Health:** Circuit breaker and health-check service for local LLM availability. ✅

- [`TASKS.md`](./TASKS.md) — **active roadmap**. All undone work, prioritized by tier (P0 → P2). Includes the query engine, knowledge graph, wiki synthesis, accumulated learnings, and inference health phases. Tasks blocked on external dependencies are clearly marked.
- [`HISTORY.md`](./HISTORY.md) — **immutable completion log**. Every finished phase and task with dates and validation results. Source of truth for what has already been built.

> Rule: when a task in `TASKS.md` is completed, move it to `HISTORY.md` — never delete it.
