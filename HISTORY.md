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

## Phase A (continued)

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

**Last Updated:** 2026-07-16
