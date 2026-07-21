# OpenBrain (OB1) Roadmap — Active Tasks

> Completed work has moved to [`HISTORY.md`](./HISTORY.md). This file tracks **undone work only**.
>
> **Status:** P0 (`pi-open-brain` package) → **COMPLETE** ✅ — all tools working end-to-end, package installed
> **Constraint:** OpenBrain runs **fully local**. All inference goes through `LOCAL_LLM_BASE_URL`
> (OpenAI-compatible). No cloud LLM providers. OpenRouter is disabled in `.env`.

## Immediate Next Actions

1. **D.1** — Deploy `learnings` + `query_sessions` schemas. ~45 min *(unblocked)*

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

- **P0 — `pi-open-brain` package:** ~~Scaffold~~ ~~tools~~ ~~skills~~ ~~test harness~~ ~~client-side embedding~~ ~~live install~~ ✅ COMPLETE.
- **P1 — Knowledge Graph:** ~~`graph_edges` table~~ ~~wikilink extraction~~ ~~tag co-mention~~ ~~graph traversal~~ ✅ COMPLETE (6,946 edges live).
- **P1 — Wiki Synthesis:** ~~`wiki_pages` schema~~ ~~synthesis engine~~ ~~`brain wiki` CLI~~ ~~context assembler~~  ✅ COMPLETE (20 pages live).
- **P2 — Accumulated Learnings:** `learnings` + `query_sessions` deployed ✅. Next: accumulator job.
- **Deferred — NateOB1-sourced tasks:** extensions, imports, dashboard, capture, advanced recipes. Repo available; start after P2.

---

# P1 · Phase B — Knowledge Graph Layer ✅ COMPLETE

> All tasks done. See HISTORY.md for the full writeup (schema design, chunk-aware
> traversal fix, extraction results). Summary: 6,946 edges live (2,958 wikilink +
> 3,988 tag co-mention), `expand_graph_neighbors` RPC, `--graph` flag in `brain query`.
> No LLM calls used — both edge sources are deterministic.

---

# P1 · Phase C — Wiki Synthesis Layer ✅ COMPLETE

> All tasks done. 20 wiki pages live. See HISTORY.md for full writeup.
> `brain wiki build` / `brain query --wiki` both working.

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

# P0 · `pi-open-brain` — Distributable Pi Package ✅ COMPLETE

> All tasks done: P0.1–P0.5, client-side embedding fix, live install confirmed.
> No remaining P0 work.

---

## Success Metrics

**Phase B complete (graph):** ✅ DONE
- ✅ `graph_edges` deployed; 2,958 wikilink edges (confidence 1.0) + 3,988 tag co-mention edges
  (confidence 0.5–0.9) = 6,946 total. No LLM used — both sources are deterministic
  (see HISTORY.md for why prose/LLM extraction was dropped in favor of tag co-mention).
- ✅ `--graph` expands retrieval via 1-hop traversal (`expand_graph_neighbors` RPC, chunk-aware).

**Phase C complete (wiki):** ✅ DONE
- ✅ `wiki_pages` deployed; 20 hub synthesis pages built and embedded (top hubs by degree ×
  content-length). No HNSW/IVFFlat index (pgvector limits to 2000 dims; exact scan is
  sufficient at this scale). FTS GIN index on title.
- ✅ `brain wiki build --skip-existing` + `brain wiki list` working.
- ✅ `brain query --wiki` retrieves matching pages via semantic + FTS, prepends to context.

**Phase D complete (learnings):**
- ✓ `learnings` + `query_sessions` deployed.
- ✓ `bin/accumulate-learnings.js` producing cross-domain insights; injected into assembler when relevant.
- ✓ `list_learnings` MCP tool live.

---

---

## Future Improvements

- **Schema-over-logic decoupling:** Abstract the "Ingestion Layer" into a formal `lib/thought-writer.js`.
- **Handling Distributed State (Silent Failures):** Introduce a locking/queueing mechanism via `workflow-status`.
- **`pi-open-brain` install smoke test (`--smoke-test` flag):** Add a self-contained verification command runnable from the installed package — e.g. `node packages/pi-open-brain/test/smoke.js --smoke-test` or a dedicated `bin/smoke-test.js` entry in `package.json`. Should confirm env vars are set, the edge function is reachable, auth works, and at least one tool call (`thought_stats`) returns a valid response — all without writing any data. Useful for post-install "is this wired correctly?" checks without needing the full dev repo smoke suite.
