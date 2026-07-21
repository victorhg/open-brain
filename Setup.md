# OpenBrain (OB1) Setup Guide

Welcome to OB1 — a local-first, personal knowledge graph orchestration system. This guide walks you through setting up your own instance from scratch.

## Prerequisites

- **Node.js** (v20+ recommended)
- **Supabase CLI** (installed and authenticated)
- **Local LLM Server** (e.g., Ollama, LocalAI) supporting an OpenAI-compatible API
- **An Obsidian Vault**

---

## 1. Supabase Infrastructure

1. **Initialize Project:**
   ```bash
   supabase init
   ```
2. **Connectivity:**
   - Create a project at [supabase.com](https://supabase.com).
   - Link your project: `supabase link --project-ref <your-project-ref>`
3. **Set Environment Variables:**
   Add these to your project's `.env`:
   - `LOCAL_LLM_BASE_URL` (e.g., `http://127.0.0.1:8000/v1`)
   - `LOCAL_EMBEDDING_MODEL`
   - `LOCAL_CHAT_MODEL`
   - `EMBEDDING_DIMENSIONS` (e.g., 2560 for Qwen3)
   - `CAPTURE_ENABLED=true`
4. **Push Schema:**
   ```bash
   supabase db push
   ```

## 2. Database Structure

The schema is defined in `schemas/`. To deploy, ensure you have your project linked and run:
```bash
# Push core agent memory schemas
supabase db push --schema public
```
This deploys the `thoughts`, `graph_edges`, `wiki_pages`, `learnings`, and `query_sessions` tables.

## 3. Obsidian Note Processing

1. **Configure Listener:**
   - The system uses `packages/pi-obsidian-listener` to watch your vault.
   - Install dependencies: `npm install` in the root.
2. **Ingest Existing Notes:**
   - Use the import recipe to backfill your vault:
     ```bash
     node recipes/obsidian-vault-import/import.js --vault-path /path/to/vault
     ```
3. **Live Sync:**
   - Start the listener to watch for `#brain-dump` tags or folder changes.

## 4. Installing Pi Packages

The OpenBrain interface is delivered via [pi](https://pi.dev) packages.

1. **Install locally inside your vault:**
   ```bash
   cd /path/to/your-obsidian-vault
   pi install /path/to/openbrain/packages/pi-open-brain -l
   ```
2. **Configure Credentials (Shell Profile):**
   *Never store these in the vault.* Add to `~/.zshrc`:
   ```bash
   export BRAIN_MCP_URL="https://<your-ref>.supabase.co/functions/v1/open-brain-mcp"
   export BRAIN_ACCESS_KEY="your-mcp-key"
   ```

## 5. Running Update Jobs

Maintenance tasks are handled via the `brain` CLI:

- **Graph Extraction:** `bin/extract-wikilink-edges.js` and `bin/extract-tag-comention-edges.js` build the connection layer.
- **Wiki Synthesis:** `brain wiki build`
- **Learnings:** The system automatically accumulates insights via the Edge Function; you can trigger query logging via standard usage.

## 6. Usage via Pi

Once installed, your `pi` instance in your vault will automatically register:
- `search_thoughts`
- `capture_thought`
- `list_thoughts`
- `thought_stats`

**Common patterns:**
- *"What do my notes say about X?"* (calls `search_thoughts`)
- *"Save this insight: [text]"* (calls `capture_thought`)
- *"Show me my recent captures"* (calls `list_thoughts`)

## Verification
Post-setup, run the smoke test to ensure everything is connected:
```bash
brain smoke-test
```
