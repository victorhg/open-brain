# OB1 (Open Brain) — pi-Driven Edition

This is your Open Brain, powered by `pi`. This configuration turns your agent into the active maintainer of your personal infrastructure.

> **Origin:** This project is a `pi`-driven adaptation of the [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1) framework created by [Nate B. Jones](https://natesnewsletter.substack.com/).

## Why this version?
Standard OB1 setup requires manual orchestration of scripts and database migrations. This version delegates these chores to `pi`, ensuring that your brain stays organized, documented, and operational with minimal friction. This system is designed to be model-agnostic, leveraging `pi` as your primary orchestrator regardless of the underlying LLM provider.

## How to use your pi-agent
Instead of running manual commands, interact with `pi` to manage your brain.

### Common Commands
- **"Set up the Household Knowledge Base."** — `pi` will verify the extension directory, apply the necessary schema updates, and configure the edge function.
- **"Import my ChatGPT data."** — `pi` will guide you through the `recipes/chatgpt-conversation-import/` workflow and execute the ingestion.
- **"Audit my current extensions."** — `pi` will scan your configuration and report on status and health.

## Project Structure
- `/extensions`: Active system modules.
- `/primitives`: Core logic (RLS, Edge Functions, MCP).
- `/recipes`: Data import and workflow automation tasks.
  - `obsidian-vault-import`: Local-first enabled tool for syncing Obsidian vaults. (Status: Successfully imported 3909 thoughts.)
  - `brain-smoke-test`: System integrity harness to verify configuration and health.
- `/skills`: Reusable agent-logic packs (model-agnostic instructions for your orchestrator).

## Verifying System Health
To ensure your Open Brain configuration is healthy and fully connected, run the smoke test harness:

```bash
node recipes/brain-smoke-test/smoke-all.js
```

This harness probes every live surface (DB, Auth, MCP) and reports on the system's status. For a more detailed breakdown of results and options (like destructive testing), see `recipes/brain-smoke-test/README.md`.

## 🧠 Agent Operational Knowledge Base
For technical deep-dives, configuration validation, and API troubleshooting (especially regarding LLM/API keys), please refer to the detailed operational guidelines located at: `recipes/LLM_Configuration_Insights.md`

## Architecture: This Repo vs. `pi-open-brain`

This project has two distinct roles that are worth keeping clearly separate.

### This repo — the development environment

This repository is the **architecture, development, and evolution environment** for Open Brain. It contains:

- The **Supabase schema** (`schemas/`) — the source of truth for every table, RPC, and index
- The **ingestion pipeline** (`integrations/obsidian-listener/`) — the watcher that processes Obsidian files and embeds them
- The **CLI** (`cli/`) — `brain query` and `brain find-relations` for local use
- The **smoke test** (`recipes/brain-smoke-test/`) — the integrity harness
- The **MCP Edge Function** (`supabase/functions/open-brain-mcp/`) — deployed to Supabase
- All **architectural decisions, migrations, and recipes**

When the knowledge graph evolves (new schemas, new embedding models, new ingestion rules), **the work happens here**. This repo is not installed anywhere — it is where the system is designed and maintained.

### `packages/pi-open-brain/` — the distributable result

The `pi-open-brain` package is the **only artifact that needs to be installed** anywhere other than this machine. It is a self-contained [pi package](https://pi.dev) that:

- Knows how to talk to the deployed Open Brain endpoint
- Registers four native pi tools (`search_thoughts`, `capture_thought`, `list_thoughts`, `thought_stats`)
- Carries a `SKILL.md` that teaches the model when to reach for the knowledge graph
- Has zero knowledge of how the database is structured, how embeddings are generated, or how ingest works — it only needs two env vars: `BRAIN_MCP_URL` and `BRAIN_ACCESS_KEY`

**To use Open Brain in any Obsidian vault or pi session**, you only install this package:

```bash
pi install git:github.com/victorhugogermano/openbrain
```

Then set two env vars and pi automatically has full, search-capable access to your knowledge graph.

### The boundary in plain words

```
┌─────────────────────────────────────────────────────────┐
│  This repo (dev environment)                            │
│                                                         │
│  schemas/  →  Supabase DB (deployed)                    │
│  integrations/obsidian-listener/  →  runs locally       │
│  supabase/functions/open-brain-mcp/  →  deployed        │
│                                          │              │
│  packages/pi-open-brain/  ──────── calls │ via HTTPS    │
│    (the distributable result)            ▼              │
└─────────────────────────────────────────────────────────┘
           │
           │  pi install git:...  (any machine)
           ▼
  ~/.pi/agent/  (installed pi package)
  → search_thoughts, capture_thought, list_thoughts, thought_stats
```

Any architecture change — new table, new embedding model, new Edge Function logic — is designed and validated in this repo first, then the resulting `pi-open-brain` package automatically reflects those changes when re-installed.

---

## 📋 Roadmap & History

- [`TASKS.md`](./TASKS.md) — **active roadmap**. All undone work, prioritized by tier (P0 → P2). Includes the query engine, knowledge graph, wiki synthesis, and accumulated learnings phases. Tasks blocked on external dependencies are clearly marked.
- [`HISTORY.md`](./HISTORY.md) — **immutable completion log**. Every finished phase and task with dates and validation results. Source of truth for what has already been built.

> Rule: when a task in `TASKS.md` is completed, move it to `HISTORY.md` — never delete it.
