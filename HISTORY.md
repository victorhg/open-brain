# OpenBrain (OB1) Implementation History

> Immutable log of **completed** work. Active/undone work lives in [`TASKS.md`](./TASKS.md).

All code is **TypeScript / Node.js**. All LLM inference is **fully local** via the OpenAI-compatible
server at `LOCAL_LLM_BASE_URL`. No cloud LLM providers.

---

## Core Infrastructure ✅

- Supabase project configured; connectivity established via `.env`.
- Core `thoughts` table with vector embeddings.
- MCP Edge Function deployed (`open-brain-mcp`).
- Brain smoke test passing (17 pass, 11 skip, 0 fail).
- 3,911 thoughts imported from the Obsidian vault.

---

## Phase 1: Core Schema & Infrastructure ✅

### Task 1.1: Deploy Agent Memory Schema ✅
**Completed:** 2026-07-13 | All 8 tables deployed, 17/17 validation checks passed.

**Tables:** `agent_memories`, `agent_memory_source_refs`, `agent_memory_artifacts`,
`agent_memory_relations`, `agent_memory_review_actions`, `agent_memory_recall_traces`,
`agent_memory_recall_items`, `agent_memory_audit_events`

### Task 1.2: Deploy Enhanced Schemas ✅
**Completed:** 2026-07-13 | 28/28 validation checks passed.

**Schemas:** `smart-ingest`, `text-search-trgm`, `enhanced-thoughts`, `workflow-status`,
`provenance-chains`

---

## Phase 1.5: Local Testing & Validation ✅

### Task 1.5.1: End-to-End Obsidian Live Listener Testing ✅
Verified `integrations/obsidian-listener` processes `#brain-dump` tagged files, chunks via headings,
embeds via the local LLM, and records provenance chains in Supabase.

### Task 1.5.2: Local Semantic Querying & Knowledge Retrieval ✅
`bin/query-brain.js` built. Supports local embedding + local chat LLM (`--answer` flag).
Semantic search against 3,911 thoughts confirmed working.

---

### Task A.2: Grounding Prompt Hardening ✅
**Completed:** 2026-07-16

- `GROUNDING_SYSTEM_PROMPT` constant added — sent as a `system` role message (not user).
- Per-chunk context headers: `[Source: {title} | {folder} | {date}]` before every chunk.
- `--strict` flag: aborts generation if max match similarity < 0.25, prints canonical
  "I don't have enough information" message without calling the LLM.
- Output label changed from "SYNTHESIZED ANSWER" → **"GROUNDED ANSWER"**.

**Files:** `bin/query-brain.js`

### Task A.3: Build `lib/context-assembler.js` ✅
**Completed:** 2026-07-16

- Extracted duplicated logic (env loading, Supabase client, `generateEmbedding`, semantic search RPC)
  into a centralized module `lib/context-assembler.js`.
- Refactored `bin/query-brain.js` and `bin/find-relations.js` to use `assembleContext()` for
  retrieval, significantly reducing code duplication and centralizing the retrieval pipeline.
- Interfaces defined for future Phase B (graph) and Phase C (wiki) integration.

**Files:** `lib/context-assembler.js`, `bin/query-brain.js`, `bin/find-relations.js`

### Task A.4: Promote Tools to Recipes ✅
**Completed:** 2026-07-16

- Moved `bin/query-brain.js` → `recipes/query-brain/index.js`.
- Moved `bin/find-relations.js` → `recipes/find-relations/index.js`.
- Created lightweight shim scripts in `bin/` to maintain CLI compatibility.
- Updated recipe imports to use `../../lib/context-assembler.js`.

**Files:** `recipes/query-brain/`, `recipes/find-relations/`, `bin/` (shims)

### Task L.1: Full-Local Hardening ✅
**Completed:** 2026-07-16

- Stripped all OpenRouter fallback branches from `integrations/obsidian-listener/process-file.js`, `recipes/obsidian-vault-import/src/llm_client.py`, and `recipes/obsidian-vault-import/src/chunker.py`.
- Removed `OPENROUTER_API_KEY` references in active code; commented out in `.env`.
- System now fails loudly if local LLM configuration is missing (no silent cloud fallbacks).
- Updated documentation in `integrations/obsidian-listener/README.md`.

**Files:** `integrations/obsidian-listener/`, `recipes/obsidian-vault-import/`, `.env`

---

## Phase 1.6: System Integrity & Maintenance ✅

### Task 1.6.1: Smoke Test Remediation & Automation ✅
**Completed:** 2026-07-16 | Resolved issues identified in `SMOKE_TEST_HANDOFF_2026-07-16.md`. Integrated `recipes/brain-smoke-test` as the canonical verification process. Updated `README.md` and `recipes/brain-smoke-test/README.md` with operational guidelines and CI integration instructions.

---


### Task A.1: Embedding Model Consistency ✅
**Completed:** 2026-07 | Dimension-consistency check run against Supabase.
All stored thoughts confirmed at a single embedding model (`LOCAL_EMBEDDING_MODEL` =
`Qwen3-Embedding-4B-4bit-DWQ`) and dimension (`EMBEDDING_DIMENSIONS` = `2560`).
No re-embed was required. `bin/reembed-thoughts.js` therefore **not built** (kept as a documented
fallback in TASKS.md should the model/dimensions ever change).

**Ground truth (verified in code):**

| Variable | Value | Verified in |
|---|---|---|
| `LOCAL_EMBEDDING_MODEL` | `Qwen3-Embedding-4B-4bit-DWQ` | `.env` |
| `EMBEDDING_DIMENSIONS` | `2560` | `.env` |
| `LOCAL_LLM_BASE_URL` | `http://127.0.0.1:8000/v1` (OpenAI-compat) | `.env` |
| `bin/query-brain.js` | reads `LOCAL_EMBEDDING_MODEL` | code |
| `recipes/obsidian-vault-import` | reads both env vars, validates on preflight | `src/config.py` |
| `integrations/obsidian-listener` | reads `EMBEDDING_DIMENSIONS` from env | code |

> **Standing rule:** if `LOCAL_EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS` changes in `.env`,
> a full re-embed is required before any new queries. Model and DB column must always match.

---

---

## Security & Embedding Consistency Hardening ✅

### Task S.1: MCP Edge Function — Local LLM Hardening ✅
**Completed:** 2026-07-18

Applied the L.1 "fully local" principle to `supabase/functions/open-brain-mcp/index.ts`.
The function previously called OpenRouter (`openai/text-embedding-3-small`, 1536 dims) for all
embeddings and LLM metadata extraction, making thoughts captured via MCP incommensurable with
the 3,911 Qwen-2560 vault thoughts. Now fully local.

**Changes:**
- Removed `OPENROUTER_API_KEY` and all `openrouter.ai` fetch calls.
- Added `LOCAL_LLM_BASE_URL`, `LOCAL_EMBEDDING_MODEL`, `LOCAL_CHAT_MODEL`, `LOCAL_LLM_API`,
  `EMBEDDING_DIMENSIONS` read from Supabase secrets via `Deno.env`.
- Dimension guard added: throws loudly if model returns ≠ `EMBEDDING_DIMENSIONS` dims.
- Fixed `match_thoughts_v2` → `match_thoughts` (RPC alignment with context-assembler + smoke test).
- `capture_thought` now uses `upsert_thought` RPC (deduplication via SHA-256 fingerprint),
  matching the Node.js watcher pattern. Previously used direct `INSERT` (bypassed dedup).
- Fails loudly if LLM config missing — no cloud fallback.
- Added deployment note: `LOCAL_LLM_BASE_URL` must be a public URL when deployed to Supabase cloud
  (e.g. Cloudflare Tunnel, Tailscale Funnel, ngrok). Works as-is for `supabase functions serve`.

**Secrets set on project `aekvtnyciybockeytbmf`:**
`LOCAL_LLM_BASE_URL`, `LOCAL_EMBEDDING_MODEL`, `LOCAL_CHAT_MODEL`, `EMBEDDING_DIMENSIONS`, `CAPTURE_ENABLED`

**Files:** `supabase/functions/open-brain-mcp/index.ts`

### Task S.2: MCP Edge Function — Security Hardening ✅
**Completed:** 2026-07-18

Addressed the leaked-key threat model for the internet-facing Edge Function.

**Changes:**
- **Rate limiter:** 30 req/min per key, sliding-window in-memory (sufficient for personal tool;
  note: resets on cold start — upgrade to Deno KV for distributed enforcement if needed).
- **Write kill-switch:** `CAPTURE_ENABLED` secret (default `true`); set to `false` to disable
  `capture_thought` instantly without redeploying.
- **Input validation:** `capture_thought` enforces a 20,000-char content cap and type check;
  `search_thoughts` caps `limit` at 25; `list_thoughts` caps at 50.
- **Explicit column selection:** all DB reads use named columns — no `SELECT *`.
- **Auth gate remains primary boundary:** `MCP_ACCESS_KEY` checked before any DB operation.
  Anon key cannot be used for reads (RLS blocks anon on `thoughts`); `MCP_ACCESS_KEY` is
  the correct personal-tool access boundary.
- Bumped `serverInfo.version` → `3.0.0`.

**Files:** `supabase/functions/open-brain-mcp/index.ts`

**Verification:** Auth rejection (401 on missing/wrong key), tools/list, thought_stats all
confirmed live against `aekvtnyciybockeytbmf`.

---

## CLI Hardening ✅

### Task A.5: Fix `brain` CLI Binary Registration ✅
**Completed:** 2026-07-18 | Commit `bb0489b`

`brain query` and `brain find-relations` were silently broken — running `brain` would fail
because the root `package.json` had no `bin` field and `cli/brain.js` lacked a shebang.

**Changes:**
- Added `#!/usr/bin/env node` shebang as line 1 of `cli/brain.js`.
- Added `"bin": {"brain": "cli/brain.js"}` field to root `package.json`.
- Made `cli/brain.js` executable (`chmod +x`).
- Registered globally via `npm link`.

**Verification:**
```
brain query --help       → Usage: brain query [options] <query> ...
brain find-relations --help → Usage: brain find-relations [options] <conceptA> <conceptB> ...
```
Both subcommands confirmed working from any directory.

**Files:** `cli/brain.js`, `package.json`

---

**Last Updated:** 2026-07-18
