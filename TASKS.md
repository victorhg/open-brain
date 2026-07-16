# OpenBrain (OB1) Roadmap — Active Tasks

> Completed work has moved to [`HISTORY.md`](./HISTORY.md). This file tracks **undone work only**.
>
> **Status:** Phase A (query engine) → **IN PROGRESS** 🔧
> **Constraint:** OpenBrain runs **fully local**. All inference goes through `LOCAL_LLM_BASE_URL`
> (OpenAI-compatible). No cloud LLM providers. OpenRouter is disabled in `.env`.

This roadmap merges two visions:
- **[OB1 by Nate B. Jones](https://github.com/NateBJones-Projects/OB1)** — the foundation: Supabase + MCP + extensions.
- **[ArchDoc](./OpenBrain%20%20Architecture%20Document%20for%20a%20Local%20Personal%20AI%20Second%20Brain.md)** — the compounding layer: grounded query engine + knowledge graph + wiki synthesis + accumulated learnings.

---

## Priority Legend

| Tier | Meaning |
|---|---|
| **P0** | Foundation — do first. Everything else compounds on it. |
| **P1** | High value, unblocked once P0 lands. |
| **P2** | The differentiator; needs P1 in place. |
| **Deferred** | NateOB1-sourced tasks — repo now available at `/tmp/NateBJones-OB1`. Intentionally after P0–P2. |

---

## What's missing (priority-ordered snapshot)

- **P0 — Query Engine finish:** grounding prompt hardening, context assembler, recipe extraction.
- **P0 — Full-local hardening:** remove residual OpenRouter fallback branches.
- **P1 — Knowledge Graph:** `graph_edges` table, wikilink + prose extraction, graph traversal.
- **P1 — Wiki Synthesis:** `wiki_pages` table, entity/synthesis pages, post-ingest refresh.
- **P2 — Accumulated Learnings:** `learnings` + `query_sessions`, accumulator job, MCP exposure.
- **Deferred — NateOB1-sourced tasks:** extensions, imports, dashboard, capture, advanced recipes. Repo available; start after P2.

---

# P0 · Phase A — Query Engine Foundation 🔧

> **Vision (ArchDoc):** a full 3-stage retrieval pipeline — semantic search → context assembly →
> grounded local generation. Every answer cites sources. Hallucination is explicitly blocked.

~~### Task A.2: Harden the Grounding Prompt~~ ✅ **Done — see HISTORY.md**

---

~~### Task A.3: Build `lib/context-assembler.js`~~ ✅ **Done — see HISTORY.md**

**Objective:** Extract retrieval + assembly out of `query-brain.js` into a reusable module —
the foundation for graph expansion (Phase B) and wiki lookup (Phase C).

**Steps:**
1. Create `lib/context-assembler.js`:
   ```typescript
   interface AssemblerOptions {
     query: string;
     topK?: number;           // default: 6
     minSimilarity?: number;  // default: 0.25
     includeGraph?: boolean;  // Phase B — default: false
     includeWiki?: boolean;   // Phase C — default: false
   }
   interface ContextResult {
     chunks: ThoughtChunk[];
     graphNeighbors: ThoughtChunk[]; // Phase B
     wikiPages: WikiPage[];          // Phase C
     assembledContext: string;
   }
   export async function assembleContext(opts: AssemblerOptions): Promise<ContextResult>
   ```
2. Move semantic search logic from `query-brain.js` into `assembleContext()`.
3. Update `query-brain.js` to call it. Stub `includeGraph` / `includeWiki` with `// TODO: Phase B/C`.

**Acceptance Test:** `query-brain.js` behaviour unchanged after refactor.
**Depends:** A.2 | **Time:** 1.5 hours | **Files:** `lib/context-assembler.js`, `bin/query-brain.js`

---

~~### Task A.4: Promote CLI Tools into Self-Contained Recipes~~ ✅ **Done — see HISTORY.md**

**Objective:** Move `bin/query-brain.js` and `bin/find-relations.js` into their own recipe folders
so they can graduate into extensions later (per AGENTS.md "modular integrity").

**Steps:**
1. Create `recipes/query-brain/` and `recipes/find-relations/`, each with:
   - the script (`index.js` or kept name), its own `README.md`, and a `package.json` if it has deps.
2. Have both recipes import the shared `lib/context-assembler.js` (A.3) rather than duplicating logic.
3. Keep thin shims in `bin/` (or update docs) so existing invocation paths still work.
4. Update the root `README.md` recipe list to reflect the new recipes.

**Acceptance Test:** both tools run from their recipe folders; smoke test still passes.
**Depends:** A.3 | **Time:** 1.5 hours
**Files:** `recipes/query-brain/`, `recipes/find-relations/`, root `README.md`

---

# P0 · Full-Local Hardening

### Task L.1: Strip Residual OpenRouter Fallback

**Objective:** OpenBrain is fully local — remove all cloud LLM fallback branches.

**Current state:** `OPENROUTER_API_KEY` is commented out in `.env` ✅, but
`integrations/obsidian-listener/process-file.js` still contains OpenRouter fallback code for both
embeddings and metadata extraction.

**Steps:**
1. In `integrations/obsidian-listener/process-file.js`, remove the OpenRouter branches for:
   - embedding generation (drop the `openrouter.ai/.../embeddings` path),
   - metadata extraction (drop the `openrouter.ai/.../chat/completions` path).
   Fail loudly if `LOCAL_LLM_BASE_URL` is unreachable — no silent cloud fallback.
2. Audit `bin/`, `recipes/`, `integrations/` for any other `openrouter` references and remove them.
3. Update `integrations/obsidian-listener/README.md` to state it is local-only.

**Acceptance Test:**
```bash
grep -rin "openrouter" bin/ recipes/ integrations/   # → no matches in executable code paths
```
**Time:** 1 hour | **Files:** `integrations/obsidian-listener/process-file.js`, README

---

# P1 · Phase B — Knowledge Graph Layer

> **Vision (ArchDoc):** hybrid graph — deterministic wikilink edges (confidence 1.0) +
> local-LLM-extracted entity/relation edges (confidence < 1.0) in `graph_edges`. Multi-hop
> traversal expands retrieval beyond semantic overlap.

### Task B.1: Deploy `graph_edges` Schema
Create `schemas/graph-edges/schema.sql` + `metadata.json`; deploy via Supabase; verify table.
Columns: `source_entity/type`, `relation_type`, `target_entity/type`, `confidence`,
`edge_source` (`'wikilink' | 'prose_extraction'`), `source_thought_id`, indexes on entities/confidence.
**Depends:** none | **Time:** 30 min

### Task B.2: Wikilink Edge Extractor (no LLM)
`bin/extract-wikilink-edges.js`: mine `metadata.wikilinks` on Obsidian thoughts, resolve to target
thoughts by title, insert deterministic edges (`confidence = 1.0`, `edge_source = 'wikilink'`,
`ON CONFLICT DO NOTHING`). Run against all 3,911 thoughts; log resolution rate.
**Depends:** B.1 | **Time:** 2 hours | **Files:** `bin/extract-wikilink-edges.js`

### Task B.3: Local Entity Extraction Worker (LLM)
Build `integrations/entity-extraction-worker/` **from scratch** (NateOB1 recipe unavailable locally).
For each thought, call the local LLM for structured JSON `{entities[], relations[]}`; normalize entity
names; insert edges with `confidence >= 0.7`, `edge_source = 'prose_extraction'`. Pilot 50 thoughts,
tune prompt, then run full batch as a background job. Add as a post-ingest step in obsidian-listener.
**Depends:** B.1, local LLM | **Time:** 3–4 hours

### Task B.4: Graph Traversal in Context Assembler
Implement the `includeGraph: true` path in `lib/context-assembler.js`: 1-hop expansion from the entities
in top semantic hits, append graph neighbors with a labeled header, expose via `--graph` in `query-brain.js`.
**Depends:** A.3, B.2, B.3 | **Time:** 2 hours

---

# P1 · Phase C — Wiki Synthesis Layer

> **Vision (ArchDoc):** a persistent, growing synthesis layer — one page per entity/concept/synthesis.
> Wiki pages are *distilled understanding*, read as pre-computed context on every query.

### Task C.1: Deploy `wiki_pages` Schema
`schemas/wiki-pages/schema.sql` + `metadata.json`: `slug` (unique), `title`, `content`, `page_type`
(`entity|concept|synthesis|answer`), `source_thought_ids`, `embedding vector(2560)`, HNSW + FTS indexes.
Include the `match_wiki_pages` RPC. Embedding dim must equal `EMBEDDING_DIMENSIONS`.
**Time:** 30 min

### Task C.2: Build Wiki Synthesis Engine (local)
Build `recipes/wiki-synthesis/` and `recipes/entity-wiki/` **from scratch** (NateOB1 unavailable),
plus a unified entry point `bin/build-wiki.js` (`--type entity|synthesis`, `--slug <slug>`, `--limit`).
Entity pages: pull top entities from `graph_edges`, gather related chunks, synthesize + embed via local LLM.
Pilot the 20 most-connected entities; verify quality in Supabase.
**Depends:** C.1, B.3 | **Time:** 3–4 hours

### Task C.3: Post-Ingest Wiki Refresh Hook
In `obsidian-listener/process-file.js`, after ingest, refresh affected entity pages (max 5/ingest)
via `bin/build-wiki.js`. Gate behind `WIKI_AUTO_UPDATE=true`. Append entries to `docs/wiki-log.md`.
**Depends:** C.2, B.3 | **Time:** 1.5 hours

### Task C.4: Wiki Lookup in Context Assembler
Implement `includeWiki: true` in `lib/context-assembler.js` (embed query → `match_wiki_pages`
+ FTS title match), prepend wiki content with a labeled header, expose via `--wiki` in `query-brain.js`.
**Depends:** A.3, B.4, C.2 | **Time:** 2 hours

---

# P2 · Phase D — Accumulated Learnings

> **Vision (ArchDoc):** a background job reviews recent queries + answers and surfaces patterns,
> contradictions, and cross-domain connections no single note contains. The **unique differentiator**.

### Task D.1: Deploy `learnings` + `query_sessions` Schemas
`schemas/learnings/schema.sql`: `learnings` (insight, related_thought_ids/entities/wiki_slugs,
confidence, `learning_type` ∈ pattern|contradiction|connection|gap|trend, session window, dismissed_at)
and `query_sessions` (query, answer, thought_ids, wiki_slugs, model_used, filed_as_wiki).
Update `query-brain.js` to log every `--answer` session.
**Depends:** Phase A | **Time:** 45 min

### Task D.2: Learnings Accumulator
`bin/accumulate-learnings.js`: review last N sessions + referenced wiki pages, prompt the local LLM for
patterns/contradictions/connections/gaps/trends (JSON, confidence ≥ 0.6), insert into `learnings`.
Flags: `--dry-run`, `--since <date>`.
**Depends:** D.1 | **Time:** 3 hours

### Task D.3: Expose Learnings (CLI + MCP)
`--learnings` flag in `query-brain.js`; optional injection in `lib/context-assembler.js` when a learning's
entities overlap the query; MCP tools `list_learnings` and `file_answer_to_wiki` in `open-brain-mcp`.
**Depends:** C.4, D.2 | **Time:** 2–3 hours

---

# Deferred — NateOB1 Reference Tasks (repo available at `/tmp/NateBJones-OB1`)

> Reference repo cloned at **`/tmp/NateBJones-OB1`**. Tasks below can now be executed.
> Priority is intentionally **after P0–P2** — build the local-first engine first, then layer extensions on top.

- **Extensions:** Household Knowledge Base (`extensions/household-knowledge/`), Home Maintenance Tracker (`extensions/home-maintenance/`), Professional CRM (`extensions/professional-crm/`), Family Calendar — best started after Phase A.
- **Data import:** ChatGPT conversation import (`recipes/chatgpt-conversation-import/`), fingerprint-dedup backfill (`recipes/fingerprint-dedup-backfill/`) — start after A.1 is confirmed stable.
- **Dashboard:** Open Brain Dashboard Next.js (`dashboards/open-brain-dashboard-next/`) — meaningful only after Phase C (wiki pages give it real content).
- **Capture integrations:** Slack capture (`integrations/slack-capture/`), Discord capture (`integrations/discord-capture/`).
- **Advanced recipes:** Daily Digest (`recipes/daily-digest/`), Life Engine (`recipes/life-engine/`) — both depend on Phase D (learnings).

---

# P0 · Also Worth Doing Post-Phase A (unblocked, local)

### Configure Cursor / Claude Code MCP Integration
Wire `open-brain-mcp` to Cursor/Claude Code for in-editor knowledge-graph access.
**Depends:** Phase A | **Time:** 30 min

---

## Success Metrics

**Phase A complete (query engine):**
- ✓ Every `--answer` response cites source note titles in `[brackets]`.
- ✓ `lib/context-assembler.js` in place with stub hooks for graph + wiki.
- ✓ No hallucination on out-of-context queries.
- ✓ `query-brain` / `find-relations` live as standalone recipes.
- ✓ No OpenRouter references remain in executable code.

**Phase B complete (graph):**
- ✓ `graph_edges` deployed; ≥ 5,000 wikilink edges (confidence 1.0); ≥ 10,000 prose edges (≥ 0.7).
- ✓ `--graph` expands retrieval via 1-hop traversal.

**Phase C complete (wiki):**
- ✓ `wiki_pages` deployed; ≥ 50 entity pages synthesised + embedded.
- ✓ `--wiki` pulls synthesised pages; post-ingest refresh working; `docs/wiki-log.md` maintained.

**Phase D complete (learnings):**
- ✓ `learnings` + `query_sessions` deployed.
- ✓ `bin/accumulate-learnings.js` producing cross-domain insights; injected into assembler when relevant.
- ✓ `list_learnings` MCP tool live.

---

## Immediate Next Actions

1. **A.2** — harden grounding prompt (system role + citations + `--strict`). ~1 h
2. **A.3** — extract `lib/context-assembler.js`. ~1.5 h
3. **A.4** — promote `query-brain` / `find-relations` into recipes. ~1.5 h
4. **L.1** — strip OpenRouter fallback from obsidian-listener. ~1 h
5. Then **B.1 → B.2** to start the graph layer.

**Time to Phase A + full-local complete:** ~5 hours focused work.
**Time to Phase B + C complete:** ~15 additional hours.
**Time to Phase D complete:** ~5 additional hours.

---

## Architecture Reference

```
Query Pipeline (target state after Phases A–D):
─────────────────────────────────────────────────────
User query
  → embed with LOCAL_EMBEDDING_MODEL via LOCAL_LLM_BASE_URL (local, OpenAI-compat)
  → Stage 1: semantic search → top-6 thoughts (pgvector cosine)
  → Stage 2: graph traversal → 1-hop neighbors via graph_edges
  → Stage 3: wiki lookup → matching wiki_pages (entity + synthesis)
  → Learnings injection → relevant cross-session insights
  → Context assembly → ranked, deduplicated, provenance-labelled
  → Grounded generation → local LLM, strict: "answer ONLY from context"
  → Session logged → query_sessions
  → Optionally filed → wiki_pages (page_type = 'answer')
─────────────────────────────────────────────────────
```

See also:
- [`HISTORY.md`](./HISTORY.md) — completed work.
- `OpenBrain  Architecture Document for a Local Personal AI Second Brain.md` — original ArchDoc vision.
- `primitives/README.md`, `schemas/README.md`.

---

**Last Updated:** 2026-07-16
**Status:** Phase A — IN PROGRESS
**Maintainer:** OB1 Orchestrator (pi)
