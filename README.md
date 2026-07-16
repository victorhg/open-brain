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
- `/skills`: Reusable agent-logic packs (model-agnostic instructions for your orchestrator).

## 🧠 Agent Operational Knowledge Base
For technical deep-dives, configuration validation, and API troubleshooting (especially regarding LLM/API keys), please refer to the detailed operational guidelines located at: `recipes/LLM_Configuration_Insights.md`

## 📋 Roadmap & History

- [`TASKS.md`](./TASKS.md) — **active roadmap**. All undone work, prioritized by tier (P0 → P2). Includes the query engine, knowledge graph, wiki synthesis, and accumulated learnings phases. Tasks blocked on external dependencies are clearly marked.
- [`HISTORY.md`](./HISTORY.md) — **immutable completion log**. Every finished phase and task with dates and validation results. Source of truth for what has already been built.

> Rule: when a task in `TASKS.md` is completed, move it to `HISTORY.md` — never delete it.
