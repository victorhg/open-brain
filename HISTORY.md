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

## P0 · `pi-open-brain` — Distributable Pi Package ✅

### Task P0.1: Scaffold `packages/pi-open-brain/` ✅
**Completed:** 2026-07-18 | Commits `bb0489b` → `6a2f6a2`

Created the full package skeleton:

```
packages/pi-open-brain/
├── package.json          # "pi-package" keyword, pi manifest, peerDependencies
├── README.md             # install docs, env vars, manual verification checklist
├── extensions/
│   └── index.ts
└── skills/
    ├── open-brain/SKILL.md
    ├── auto-capture/       (moved from root skills/)
    └── panning-for-gold/   (moved from root skills/)
```

**Files:** `packages/pi-open-brain/`

### Task P0.2: Implement Extension Tools ✅
**Completed:** 2026-07-18

Implemented four native pi tools in `extensions/index.ts`. Each tool calls the deployed
Supabase Edge Function directly via HTTPS JSON-RPC — no MCP protocol layer.

| Tool | Method | Notes |
|---|---|---|
| `search_thoughts` | `tools/call` | `query`, `limit`, `threshold` |
| `capture_thought` | `tools/call` | gated by `CAPTURE_ENABLED` on server |
| `list_thoughts` | `tools/call` | `limit` param |
| `thought_stats` | `tools/call` | returns total count |

- Auth: `x-brain-key` header only (no query params).
- Config: `BRAIN_MCP_URL` + `BRAIN_ACCESS_KEY` from env.
- `session_start` emits a `ctx.ui.notify` warning if env vars are missing — no crash.
- Typed `McpResponse` interface; graceful HTTP error handling (401, 429, non-ok).

**Files:** `packages/pi-open-brain/extensions/index.ts`

### Task P0.3: Skills + README ✅
**Completed:** 2026-07-18

**Skills shipped with the package (3 total):**
- `open-brain/SKILL.md` — core: teaches model when/how to use the 4 tools.
- `auto-capture/SKILL.md` — behavioral protocol for end-of-session captures; uses `capture_thought` + `search_thoughts`.
- `panning-for-gold/SKILL.md` — transcript/brain-dump → evaluated idea inventory → Open Brain captures.

Both `auto-capture` and `panning-for-gold` were moved from the root `skills/` directory into
the package — they require `open_brain: true` and belong with the distributable, not the
development environment. Broken relative link in `auto-capture/SKILL.md` fixed (repo reference
replaced with plain URL to the dev repo).

`skills/README.md` added at repo root to establish the boundary: root `skills/` is reserved
for dev/architecture skills only.

**`README.md`** covers: install commands, required env vars, tool table, test commands,
manual verification checklist, update/uninstall.

**Files:** `packages/pi-open-brain/skills/`, `packages/pi-open-brain/README.md`, `skills/README.md`

### Task P0.5: Full Test Harness ✅
**Completed:** 2026-07-18 | Commits `0c22fbb`, `3e50c8b`

Three-layer test harness for the `pi-open-brain` package:

**Layer 1 — `packages/pi-open-brain/test/smoke.js`** (standalone HTTP, no pi required):
Walks up to find `.env`; auto-derives `BRAIN_MCP_URL`; 7 checks covering auth rejection,
query-param security regression, `thought_stats`, `search_thoughts`, `list_thoughts`.

**Layer 2 — `packages/pi-open-brain/test/pi-load.js`** (pi SDK, no LLM):
Dynamically imports pi SDK from global npm root; loads the extension in-process;
asserts all 4 tools registered, all 3 skills (`open-brain`, `auto-capture`, `panning-for-gold`)
loaded, zero errors or warnings. 9/9 passing.

**Layer 3 — `recipes/brain-smoke-test/smoke-all.js` integration**:
Added `Pi Package: open-brain` category (5 checks): URL configured, header-only auth,
`thought_stats`, `search_thoughts`, `list_thoughts`. Skips cleanly when `BRAIN_MCP_URL` unset.

**Files:** `packages/pi-open-brain/test/pi-load.js`, `packages/pi-open-brain/test/smoke.js`,
`recipes/brain-smoke-test/smoke-all.js`

### Option B: Client-Side Embedding Fix ✅
**Completed:** 2026-07-18 | Commit `bee3462`

**Problem:** `search_thoughts` and `capture_thought` both called `generateEmbedding()` server-side
inside the Supabase edge function, which tried to reach `LOCAL_LLM_BASE_URL=http://127.0.0.1:8000/v1`
— unreachable from Supabase cloud. Both tools were non-functional in production.

**Fix:**
- `packages/pi-open-brain/extensions/index.ts`: added `generateEmbeddingLocally()` — calls the
  local LLM on the user's machine (where it is reachable). Respects `LOCAL_LLM_API` bearer token.
  45s timeout on edge function calls via `AbortController`. Injects pre-computed vector into
  `search_thoughts` and `capture_thought` args before sending to the edge function.
- `supabase/functions/open-brain-mcp/index.ts`: both handlers accept optional `embedding` param;
  use the client-provided vector directly (dimension-validated at `EMBEDDING_DIMENSIONS`);
  fall back to `generateEmbedding()` only for local `supabase functions serve` dev.
- `recipes/brain-smoke-test/smoke-all.js`: added `generateEmbeddingForSmoke()` helper (mirrors
  extension logic, includes `LOCAL_LLM_API` bearer header); destructive checks now pre-embed
  locally; `pi-open-brain: search_thoughts` upgraded from permanent `⚠ SkipError` to real
  pass/fail; `capture_thought` check now detects `isError: true`.

**Smoke suite after fix:** 29 pass, 8 skip, 0 fail (previously: 23/10/0 read-only, failed destructive).

---

### Task P0.4: Live Vault Install ✅
**Completed:** 2026-07-18

Confirmed `pi-open-brain` was already installed as a local path package
(`../../Development/openbrain/packages/pi-open-brain` in `pi list`).
Verified via `pi-load.js`: 9/9 checks pass — all 4 tools and 3 skills load cleanly,
zero errors or warnings.

### Task P0.6: Add smoke-test command ✅
**Completed:** 2026-07-21

- Added `smoke-test` script to `pi-open-brain/package.json`.
- Implemented `brain smoke-test` CLI command in `open-brain-cli`.
- Verified connectivity check post-install.

**Files:** `packages/pi-open-brain/package.json`, `packages/open-brain-cli/bin/brain.js`, `packages/open-brain-cli/commands/smoke-test.js`

**P0 phase now fully complete.**

---

## P1 · Phase B — Knowledge Graph Layer ✅

### Task B.1–B.4: Deploy `graph_edges` + Deterministic Traversal ✅
**Completed:** 2026-07-21 | Commit `6121f6b`

Built a thought-centric knowledge graph enabling 1-hop retrieval expansion
beyond pure semantic similarity — zero LLM calls, fully deterministic.

**Schema design decision:** the original plan (see old TASKS.md draft)
spec'd an entity-centric schema (`source_entity`, `relation_type`,
`target_entity`). Rejected in favor of thought-to-thought edges
(`source_thought_id → target_thought_id`) because the actual retrieval
use case is "I found thought A semantically — what other thoughts are
strongly connected to it?" — entity names live in `metadata` jsonb on the
edge, not as separate graph nodes. Keeps traversal to a single indexed
lookup instead of an entity-resolution join.

**Simplification decision (before implementation):** the original plan
included a Task B.3 for LLM-based entity/relation extraction
(`integrations/entity-extraction-worker/`, ~4,000 API calls, hours of
processing). Dropped in favor of a **tag co-mention extractor** —
deterministic, free, and sufficient: wikilinks alone cover 89% of the
vault (3,536/3,965 thoughts), tags cover the remaining gap. Reserved LLM
entity extraction as a possible future Phase D+ enhancement, not blocking
Phase B.

**Critical discovery during implementation (chunking):** Obsidian notes
are chunked by heading into multiple `thoughts` rows — 72% of the vault
(2,871/3,965 thoughts) belongs to a multi-chunk note, and every chunk of
a note shares the identical `metadata.title` and `metadata.wikilinks`
list (verified: a 6-chunk note had the same 57-link wikilinks array on
every chunk). Naive chunk-to-chunk edge extraction produces a bipartite
explosion: 16,643 raw wikilink references across chunks naively expand to
36,296+ edges ("218% resolution rate" — the tell that something was
wrong). Fixed by:
1. Extracting edges between **canonical thought IDs** — one representative
   chunk per note, deterministically chosen as `MIN(id)` (string
   comparison) among that note's chunks.
2. Making `expand_graph_neighbors` **chunk-aware**: given seed thought IDs
   from semantic search (which can be any chunk of a note, not
   necessarily canonical), the RPC first maps each seed to its note's
   canonical ID via a join on `metadata->>'title'`, queries edges using
   that canonical ID, then maps the neighbor's canonical ID back to the
   *most substantive chunk* (longest content) of that note before
   returning it — so callers get real content, not an arbitrary
   frontmatter fragment.
3. Excluding neighbors that are just a different chunk of a **seed's own
   note** (title match, not just literal ID match) — caught during manual
   verification when a graph expansion returned the same note as one of
   the semantic hits under a different chunk ID.

**Postgres gotcha:** `MIN(uuid)` is not a valid aggregate in Postgres
(`function min(uuid) does not exist`) — fixed by casting to text
(`MIN(t.id::text)::uuid`), matching the JS extractor's string comparison
for a consistent canonical choice between the two languages.

**B.1 — Schema:** `schemas/graph-edges/schema.sql` + `metadata.json` +
`README.md`. Table: `graph_edges` (source/target thought UUIDs,
`edge_source` check-constrained to `'wikilink' | 'tag_comention'`,
`confidence numeric(4,3)`, `metadata jsonb`, unique on
`(source,target,edge_source)`, no self-loops). RLS enabled,
service-role-only policy (matches `thoughts` table posture).
`expand_graph_neighbors(p_thought_ids, p_min_confidence, p_limit)` RPC,
granted to `authenticated`/`service_role` only. Expression index
`idx_thoughts_title_expr` on `metadata->>'title'` supports the RPC's
double title join. Deployed via `supabase link` + `supabase db push`
(required decoding the URL-encoded `SUPABASE_DB_PASSWORD` from `.env` and
setting it as an env var — `supabase db push --dry-run` confirmed
connectivity before the real push).

**B.2 — Wikilink extractor:** `bin/extract-wikilink-edges.js`. Groups
thoughts by normalized title, takes the longest observed wikilinks list
per note (chunks carry duplicates), resolves each link to a target note's
canonical ID (case-insensitive title match), dedupes by
`sourceCanonical->targetCanonical` pair before writing. Idempotent
upsert. **Result: 2,958 edges from 4,923 note-level link references
(60.1% resolution).** Top unresolved targets are non-existent notes
("Daily Notes" referenced 403x, "Livros" 88x) — expected, not a bug.

**B.3 — Tag co-mention extractor:** `bin/extract-tag-comention-edges.js`.
Connects notes sharing a specific tag, filtered to a frequency band
(tunable `MIN_TAG_FREQ`/`MAX_TAG_FREQ` constants) to avoid both
one-off-tag noise and generic-tag explosion. Initial band [5,50] produced
14,091 edges — investigated and found the top few tags near 50 occurrences
(`#chines` 49 notes, `#kindle`/`#highlights` 47 notes each) contributed
the bulk via quadratic pair growth (`#chines` alone: 1,176 pairs). Tightened
to [5,20], bringing the count to the same order of magnitude as the
wikilink graph. Confidence scaled linearly by tag rarity within the band
(0.9 at freq=5 down to 0.5 at freq=20) — always below wikilink confidence
(1.0), since co-tagging is a weaker signal than an explicit link. **Result:
3,988 edges from 90 in-band tags (of 586 unique tags total).**

**B.4 — Context assembler + `--graph` flag:** Implemented Stage 2 in
`lib/context-assembler.js` (previously a TODO stub) — `includeGraph: true`
calls `expand_graph_neighbors` with the top semantic hit IDs as seeds; new
`graphMinConfidence` (default 0.5) and `graphLimit` (default 10) options.
Neighbors are appended to `assembledContext` under a `[Graph Expansion]`
header with `via: {edge_source}, confidence: {confidence}` annotations.
Exposed as `--graph` in `cli/commands/query.js` →
`recipes/query-brain/index.js`, printing a labeled section listing each
neighbor with a 🔗/🏷️ icon per edge type.

**Total graph: 6,946 edges** (2,958 wikilink + 3,988 tag_comention).
Verified end-to-end: `brain query "ethics in artificial intelligence"
--graph` correctly expands a non-canonical chunk seed through its note's
canonical ID and returns 10 distinct, substantive neighbor notes.

**Files:** `schemas/graph-edges/`, `bin/extract-wikilink-edges.js`,
`bin/extract-tag-comention-edges.js`, `lib/context-assembler.js`,
`cli/commands/query.js`, `recipes/query-brain/index.js`,
`supabase/migrations/20260721105036_graph_edges.sql`,
`supabase/migrations/20260721110548_graph_edges_exclude_same_note.sql`.

**Verification:** Full smoke suite after deployment: 30 pass, 7 skip,
0 fail (was 29/8/0 — `graph_edges` table now detected with 6,946 rows).

---

**Last Updated:** 2026-07-21


## P1 · Phase C — Wiki Synthesis Layer ✅

### Task C.1–C.4: Deploy wiki_pages + Build + CLI + Retrieval ✅
**Completed:** 2026-07-21 | Commit `447dd09`

Pre-computed synthesis layer: one wiki page per well-connected hub note,
distilling it and its graph neighbors into a 250-350 word second-person
synthesis, embedded and retrievable by semantic + FTS.

**Design decisions vs. original plan:**
- **No HNSW/IVFFlat vector index**: pgvector limits both index types to
  2000 dims on this Supabase version; `wiki_pages` stays small (20-200 rows)
  so an exact sequential scan is fast enough. Comment in schema documents the
  threshold for adding an approximate index (>~10k rows).
- **`page_type` free-text, not enum**: start with `hub_synthesis` only.
  Expand when a second synthesis path is validated.
- **One script, not two recipes**: `bin/build-wiki.js` replaces the planned
  `recipes/wiki-synthesis/` + `recipes/entity-wiki/` split. No evidence yet
  that the synthesis paths differ enough to warrant separate code.
- **C.3 demoted**: post-ingest live hook → `brain wiki build` CLI command.
  A live hook on every file save would trigger synthesis during vault syncs
  (dozens of ingest events per minute). CLI command on demand or via cron is
  the right shape for personal tooling.

**Hub selection**: ranked by `degree × hub_content_length`. This filters out
structural index notes (high degree but short own content, like course
syllabi) in favor of notes with both connections AND prose.

**Context cap**: 12 neighbors × 500 chars each (~3 000-6 000 char prompt =
~750-1 500 tokens). Well within the local model (Gemma 4 26B) context window.

**Synthesis quality**: verified on 3 pages before full run. Output is
specific, grounded, references real note titles/authors, written in second
person ("Your notes on X reveal..."). Avg synthesis length ~2 000 chars.

**Timing**: first synthesis ~116s (model cold start); subsequent pages ~25s
each. 20 pages built in ~10 minutes. `--skip-existing` flag added so re-runs
after new ingests only rebuild new/missing pages.

**Found during build**: `match_thoughts` (3 967 rows, no vector index on
2560-dim column) takes ~15-20s — existing baseline, not a new issue. Added
`timeout: 45_000` support to smoke-all.js check runner to accommodate LLM
embed + Supabase round-trip latency in destructive Core Features checks.

**Files:** `schemas/wiki-pages/`, `bin/build-wiki.js`, `cli/commands/wiki.js`,
`cli/brain.js`, `lib/context-assembler.js` (Stage 3 implemented),
`cli/commands/query.js`, `recipes/query-brain/index.js`,
`recipes/brain-smoke-test/smoke-all.js`.

**Smoke suite:** 30 pass, 7 skip, 0 fail (unchanged from Phase B).

---

## P2 · Phase D — Accumulated Learnings

### Task D.1 — Deploy `learnings` + `query_sessions` schemas ✅
**Completed:** 2026-07-21

- Deployed `learnings` (insights, confidence, types) and `query_sessions` (tracking for accumulation) to Supabase.
- Verified schema deployment via `supabase db push`.

**Tables:** `learnings`, `query_sessions`.
**Files:** `schemas/learnings/schema.sql`.

### Task D.2: Learnings Accumulator ✅
**Completed:** 2026-07-21

- Implemented `accumulate_learnings` tool in `pi-open-brain` extension.
- Implemented corresponding logic in `supabase/functions/open-brain-mcp/index.ts` to query `query_sessions` + `wiki_pages`, synthesize via local LLM, and insert results into `learnings`.
- Deployed edge function to Supabase.

**Files:** `packages/pi-open-brain/extensions/index.ts`, `supabase/functions/open-brain-mcp/index.ts`.

### Task D.3: Expose Learnings (CLI + MCP) ✅
**Completed:** 2026-07-21

- Added `--learnings` flag to `brain query` CLI.
- Updated `lib/context-assembler.js` to optionally inject `learnings` into retrieval pipeline.
- Updated `recipes/query-brain/index.js` to display accumulated insights when `--learnings` is requested.

**Files:** `lib/context-assembler.js`, `cli/commands/query.js`, `recipes/query-brain/index.js`.

## Phase E · Inference Health ✅

### Task E.1–E.3: Inference Health Hardening ✅
**Completed:** 2026-07-21

- Created `lib/llm-health.js` as a centralized circuit-breaker utility.
- Integrated health-checks into CLI query synthesis (`recipes/query-brain/index.js`) and Edge Function (`supabase/functions/open-brain-mcp/index.ts`).
- Systems now fail gracefully when local LLM is unreachable.

**Files:** `lib/llm-health.js`, `recipes/query-brain/index.js`, `supabase/functions/open-brain-mcp/index.ts`.

## Phase F · Monorepo Refactor ✅

### Task F.1: Monorepo Workspace Migration ✅
**Completed:** 2026-07-21

- Converted root to npm workspace.
- Extracted shared logic to `packages/open-brain-core`.
- Moved CLI to `packages/open-brain-cli`.
- Moved Obsidian listener to `packages/obsidian-listener`.
- Migrated legacy scripts from `bin/` into dedicated `recipes/` packages (`wiki-builder`, `graph-extractors`).
- Fixed all cross-package imports and binary registrations.

**Files:** `package.json`, `packages/`, `recipes/`.

### Task P0.7: Increase stability threshold for watcher ✅
**Completed:** 2026-07-21

- Increased `stabilityThreshold` to 10000ms in `packages/obsidian-listener/watcher.js` to mitigate autosave noise.
- Logged future requirement for diff-based ingestion in `TASKS.md`.

**Files:** `packages/obsidian-listener/watcher.js`, `TASKS.md`

---

---

**Last Updated:** 2026-07-21
