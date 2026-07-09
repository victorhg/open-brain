# OB1 (Open Brain) — pi-Driven Edition

This is your Open Brain, powered by `pi`. This configuration turns your agent into the active maintainer of your personal infrastructure.

> **Origin:** This project is a `pi`-driven adaptation of the [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1) framework created by [Nate B. Jones](https://natesnewsletter.substack.com/).

## Why this version?
Standard OB1 setup requires manual orchestration of scripts and database migrations. This version delegates these chores to `pi`, ensuring that your brain stays organized, documented, and operational with minimal friction.

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
- `/skills`: Reusable agent-logic packs.

## Getting Started
1. **Ensure environment connectivity:** Point `pi` to your existing Supabase project.
2. **Verify the environment:** Run `pi` and give the command: *"Initialize system check."*
3. **Start adding features:** Begin with `extensions/household-knowledge/`.

---
*Open Brain is the infrastructure layer for your thinking. No middleware, no SaaS chains.*
