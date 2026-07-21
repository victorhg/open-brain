# OpenBrain (OB1) Roadmap — Active Tasks

> Completed work has moved to [`HISTORY.md`](./HISTORY.md). This file tracks **undone work only**.
>
> **Status:** P0 (`pi-open-brain` package) → **DONE** ✅ except P0.4 (live install) — all tools working end-to-end
> **Constraint:** OpenBrain runs **fully local**. All inference goes through `LOCAL_LLM_BASE_URL`
> (OpenAI-compatible). No cloud LLM providers. OpenRouter is disabled in `.env`.

## Immediate Next Actions

1. **P0.4** — `pi install ./packages/pi-open-brain` in vault + manual end-to-end verification. ~30 min
2. **B.1** — Deploy `graph_edges` schema. ~30 min *(unblocked)*

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

- **P0 — `pi-open-brain` package:** ~~Scaffold~~ ~~tools~~ ~~skills~~ ~~test harness~~ ~~client-side embedding~~ ✅ · **P0.4 live install** is the only remaining item.
- **P1 — Knowledge Graph:** `graph_edges` table, wikilink + prose extraction, graph traversal.
- **P1 — Wiki Synthesis:** `wiki_pages` table, entity/synthesis pages, post-ingest refresh.
- **P2 — Accumulated Learnings:** `learnings` + `query_sessions`, accumulator job, MCP exposure.
- **Deferred — NateOB1-sourced tasks:** extensions, imports, dashboard, capture, advanced recipes. Repo available; start after P2.

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
Build `integrations/entity-extraction-worker/` **from scratch**.
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
Build `recipes/wiki-synthesis/` and `recipes/entity-wiki/` **from scratch**,
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

# Deferred — NateOB1 Reference Tasks

> Reference repo cloned at **`/tmp/NateBJones-OB1`**. Tasks below can now be executed.
> Priority is intentionally **after P0–P2** — build the local-first engine first, then layer extensions on top.

- **Extensions:** Household Knowledge Base (`extensions/household-knowledge/`), Home Maintenance Tracker (`extensions/home-maintenance/`), Professional CRM (`extensions/professional-crm/`), Family Calendar — best started after Phase A.
- **Data import:** ChatGPT conversation import (`recipes/chatgpt-conversation-import/`), fingerprint-dedup backfill (`recipes/fingerprint-dedup-backfill/`) — start after A.1 is confirmed stable.
- **Dashboard:** Open Brain Dashboard Next.js (`dashboards/open-brain-dashboard-next/`) — meaningful only after Phase C (wiki pages give it real content).
- **Capture integrations:** Slack capture (`integrations/slack-capture/`), Discord capture (`integrations/discord-capture/`).
- **Advanced recipes:** Daily Digest (`recipes/daily-digest/`), Life Engine (`recipes/life-engine/`) — both depend on Phase D (learnings).

---

# P0 · `pi-open-brain` — Distributable Pi Package *(one task remaining)*

> P0.1–P0.3, P0.5, client-side embedding fix all complete. Only P0.4 remains.

### Task P0.4: Live Vault Install
Install the package into the Obsidian vault environment (`pi install ./packages/pi-open-brain`).
Verify all 4 tools appear in the pi startup header. Run a manual `search_thoughts` and
`thought_stats` to confirm end-to-end. Follow the checklist in `packages/pi-open-brain/USAGE.md`.

**Depends:** P0.2, P0.3, embedding fix ✅ | **Time:** 30 min

---

## Success Metrics

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

---

## Future Improvements

- **Schema-over-logic decoupling:** Abstract the "Ingestion Layer" into a formal `lib/thought-writer.js`.
- **Handling Distributed State (Silent Failures):** Introduce a locking/queueing mechanism via `workflow-status`.
