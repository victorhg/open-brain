# OpenBrain (OB1) Implementation Roadmap

> **Status:** Phase 1 complete ✅ | Phase A (Query Engine Upgrade) → **IN PROGRESS** 🔧

This document outlines the implementation roadmap for completing the OpenBrain architecture.
It merges two visions:
- **[OB1 by Nate B. Jones](https://github.com/NateBJones-Projects/OB1)** — the foundation: Supabase + MCP + extensions ecosystem
- **[ArchDoc](./OpenBrain%20%20Architecture%20Document%20for%20a%20Local%20Personal%20AI%20Second%20Brain.md)** — the compounding layer: grounded query engine + knowledge graph + wiki synthesis + accumulated learnings

All code is **TypeScript / Node.js**. All LLM inference is **local via Ollama** where possible.
See `analysis-openbrain-viability.md` for the full viability analysis that produced this roadmap.

---

## Current Implementation Status

### ✅ Completed
- **Core Infrastructure**
  - Supabase project configured
  - Core `thoughts` table with vector embeddings
  - MCP Edge Function deployed (`open-brain-mcp`)
  - Brain smoke test passing (17 pass, 11 skip, 0 fail)
  - 3,911 thoughts successfully imported from Obsidian vault

- **Schemas (Phase 1)**
  - `agent-memory` — 8-table governed agent memory with provenance (deployed + validated)
  - `smart-ingest` — content fingerprint deduplication + ingestion job tracking
  - `text-search-trgm` — pg_trgm GIN index (~150ms ILIKE vs ~8s baseline)
  - `enhanced-thoughts` — `type`, `importance`, `quality_score`, `sensitivity_tier`, `source_type`, `enriched` columns + 4 RPCs
  - `workflow-status` — task/idea lifecycle tracking
  - `provenance-chains` — derivation lineage with walking RPCs

- **Recipes / Tools**
  - `brain-smoke-test` — system validation harness
  - `obsidian-vault-import` — 3,909 thoughts imported
  - `auto-capture` — session capture protocol
  - `panning-for-gold` — brain dump → structured insight pipeline
  - `bin/query-brain.js` — semantic search CLI with local LLM `--answer` flag
  - `bin/find-relations.js` — relation lookup utility
  - `integrations/obsidian-listener` — real-time vault file watcher

- **Primitives**
  - All 5 core primitives available (deploy-edge-function, remote-mcp, rls, shared-mcp, troubleshooting)

### ❌ Missing (priority order)
- **Query Engine** — no grounding prompt, no context assembler, no 3-stage retrieval
- **Embedding consistency** — confirm all thoughts share the same `LOCAL_EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` (Task A.1)
- **Knowledge Graph** — no `graph_edges` table, no entity extraction, no graph traversal in queries
- **Wiki Synthesis Layer** — no `wiki_pages` table, no post-ingest synthesis, no wiki lookup in queries
- **Accumulated Learnings** — no `learnings` table, no cross-session insight accumulation
- **Extensions** — 0 of 6 core extensions deployed
- **Dashboard** — no web interface deployed
- **Capture Sources** — Slack, Discord not configured
- **Advanced Recipes** — 4 of 50+ available

---

## Phase 1: Core Schema & Infrastructure ✅ COMPLETE

### Task 1.1: Deploy Agent Memory Schema ✅
**Completed:** 2026-07-13 | All 8 tables deployed, 17/17 validation checks passed.

**Tables:** `agent_memories`, `agent_memory_source_refs`, `agent_memory_artifacts`,
`agent_memory_relations`, `agent_memory_review_actions`, `agent_memory_recall_traces`,
`agent_memory_recall_items`, `agent_memory_audit_events`

---

### Task 1.2: Deploy Enhanced Schemas ✅
**Completed:** 2026-07-13 | 28/28 validation checks passed.

**Schemas:** `smart-ingest`, `text-search-trgm`, `enhanced-thoughts`, `workflow-status`, `provenance-chains`

---

## Phase 1.5: Local Testing & Validation ✅ COMPLETE

### Task 1.5.1: End-to-End Obsidian Live Listener Testing ✅
Verified `integrations/obsidian-listener` processes `#brain-dump` tagged files, chunks via headings,
embeds via local LLM, and records provenance chains in Supabase.

### Task 1.5.2: Local Semantic Querying & Knowledge Retrieval ✅
`bin/query-brain.js` built. Supports local embedding + local chat LLM (`--answer` flag).
Semantic search against 3,911 thoughts confirmed working.

---

## Phase A: Query Engine Upgrade 🔧 NOW — Priority: Critical

> **Vision (ArchDoc):** Replace the basic `--answer` CLI with a full 3-stage retrieval pipeline:
> semantic search → context assembly → grounded local generation.
> Every answer must cite its sources. Hallucination must be explicitly blocked.

---

### Task A.1: Verify and Enforce Embedding Model Consistency

**Objective:** Ensure every thought — past and future — is embedded with the single model defined
by `LOCAL_EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` in `.env`. Mixed models in the same
vector column produce meaningless similarity scores.

**Ground truth (from code):**

| Variable | Current value | Verified in |
|---|---|---|
| `LOCAL_EMBEDDING_MODEL` | `Qwen3-Embedding-4B-4bit-DWQ` | `.env` |
| `EMBEDDING_DIMENSIONS` | `2560` | `.env` |
| `LOCAL_LLM_BASE_URL` | `http://127.0.0.1:8000/v1` (OpenAI-compat) | `.env` |
| `bin/query-brain.js` | reads `LOCAL_EMBEDDING_MODEL` ✅ | code |
| `recipes/obsidian-vault-import` | reads both env vars, validates on preflight ✅ | `src/config.py` |
| `integrations/obsidian-listener` | reads `EMBEDDING_DIMENSIONS` from env ✅ | fixed this session |

**Steps:**
1. Confirm all stored thoughts share the same dimension:
   ```sql
   SELECT array_length(embedding::real[], 1) AS dims, count(*)
   FROM thoughts
   WHERE embedding IS NOT NULL
   GROUP BY 1
   ORDER BY 1;
   ```
   Expected: a single row with `dims = 2560` (matching `EMBEDDING_DIMENSIONS`).
   Multiple rows = thoughts embedded with different models → run the re-embed in Step 3.

2. Run the obsidian-vault-import preflight to confirm the live model output matches the DB:
   ```bash
   cd recipes/obsidian-vault-import
   python import-obsidian.py --test-embeddings
   # → SUCCESS: received 2560-dimensional vector — matches EMBEDDING_DIMENSIONS.
   ```

3. **Only if Step 1 shows mixed dims:** write `bin/reembed-thoughts.js`:
   - Read `LOCAL_LLM_BASE_URL`, `LOCAL_EMBEDDING_MODEL`, `LOCAL_LLM_API`, `EMBEDDING_DIMENSIONS`
     from `.env` — no hardcoded model names or dimensions anywhere
   - Fetch all thoughts in batches of 50
   - Call `POST {LOCAL_LLM_BASE_URL}/embeddings` with `{ model: LOCAL_EMBEDDING_MODEL, input: content }`
   - Assert `embedding.length === parseInt(EMBEDDING_DIMENSIONS)` — throw on mismatch, never silently swap models
   - Upsert corrected embeddings; skip thoughts already at the correct dimension
   ```bash
   node bin/reembed-thoughts.js --dry-run   # preview counts, no writes
   node bin/reembed-thoughts.js             # full re-embed
   ```

4. Rule: if `LOCAL_EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS` ever changes in `.env`,
   re-run Step 3 before issuing any new queries. Model and DB column must always match.

**Acceptance Test:**
```bash
# Confirm single dimension in DB
psql $DATABASE_URL -c   "SELECT array_length(embedding::real[], 1) AS dims, count(*) FROM thoughts WHERE embedding IS NOT NULL GROUP BY 1;"
# → exactly one row, dims = value of EMBEDDING_DIMENSIONS

# Confirm query-brain uses the local model end-to-end
node bin/query-brain.js "what did I write about deep work?" --limit 5
# → semantically correct chunks, similarity > 0.25, no cloud call made
```

**Dependencies:** Local LLM server running at `LOCAL_LLM_BASE_URL`  
**Time Estimate:** 30 min to verify — 2–3 hours only if full re-embed is needed  
**Files:** `bin/reembed-thoughts.js` (new, only if re-embed is needed)
---

### Task A.2: Add Grounding Prompt to `query-brain.js`

**Objective:** Enforce strict context-grounding in the `--answer` path. The local LLM must answer
*only* from retrieved context and explicitly say "I don't know" when context is absent.

**Why:** Current `--answer` sends context to the LLM with no system prompt constraint.
This allows the model to blend vault knowledge with its training data — the core hallucination risk.

**Steps:**
1. Open `bin/query-brain.js` and locate the `--answer` LLM call block.
2. Replace the existing system prompt (or add one if absent) with the grounding template:
   ```typescript
   const GROUNDING_SYSTEM_PROMPT = `You are a personal knowledge assistant.
   Answer the user's question using ONLY the context passages provided below.
   Rules:
   - If the context contains a clear answer, provide it and cite the source note title in [brackets].
   - If the context is partially relevant, share what it says and note its limits.
   - If the context does not contain enough information, respond with:
     "I don't have enough information in your notes to answer this."
   - Never use knowledge from outside the provided context.
   - Never invent facts, dates, names, or relationships not present in the context.`;
   ```
3. Pass `GROUNDING_SYSTEM_PROMPT` as the `system` field in the Ollama chat call.
4. In the context block sent to the LLM, prepend each chunk with its source metadata:
   ```
   [Source: {thought.metadata.title} | {thought.metadata.folder} | {thought.created_at}]
   {thought.content}
   ```
5. Add a `--strict` flag that aborts generation if retrieved similarity scores are all below `0.25`.

**Acceptance Test:**
```bash
# Should cite real note titles
node bin/query-brain.js "what are my goals for the masters thesis?" --answer

# Should return "I don't have enough information" — not hallucinate
node bin/query-brain.js "what is the population of Mars in 2150?" --answer --strict
```

**Dependencies:** Task A.1 (embedding consistency verified)  
**Time Estimate:** 1 hour  
**Files:** `bin/query-brain.js` (update)

---

### Task A.3: Build Context Assembler Module

**Objective:** Extract the retrieval + assembly logic from `query-brain.js` into a reusable
`lib/context-assembler.js` module. This is the foundation for graph-expanded retrieval (Phase B)
and wiki lookup (Phase C).

**Steps:**
1. Create `lib/context-assembler.js` with the following interface:
   ```typescript
   interface AssemblerOptions {
     query: string;
     topK?: number;           // default: 6
     minSimilarity?: number;  // default: 0.25
     includeGraph?: boolean;  // Phase B — default: false
     includeWiki?: boolean;   // Phase C — default: false
   }

   interface ContextResult {
     chunks: ThoughtChunk[];        // ranked semantic hits
     graphNeighbors: ThoughtChunk[]; // Phase B: 1-hop graph expansions
     wikiPages: WikiPage[];          // Phase C: matching synthesis pages
     assembledContext: string;       // ready-to-inject prompt block
   }

   export async function assembleContext(opts: AssemblerOptions): Promise<ContextResult>
   ```
2. Move existing semantic search logic from `query-brain.js` into `assembleContext()`.
3. Update `query-brain.js` to call `assembleContext()` instead of inline search.
4. Stub out `includeGraph` and `includeWiki` paths with `// TODO: Phase B` / `// TODO: Phase C` comments.

**Acceptance Test:** `query-brain.js` behaviour unchanged after refactor. All existing tests pass.

**Dependencies:** Task A.2  
**Time Estimate:** 1.5 hours  
**Files:** `lib/context-assembler.js` (new), `bin/query-brain.js` (refactor)

---

## Phase B: Knowledge Graph Layer 🔧 NEXT — Priority: High

> **Vision (ArchDoc):** Build a hybrid knowledge graph — deterministic wikilink edges (confidence 1.0)
> + LLM-extracted entity/relation edges (confidence < 1.0) — stored in a `graph_edges` table.
> Multi-hop traversal then expands retrieval beyond keyword/semantic overlap.

---

### Task B.1: Deploy `graph_edges` Schema

**Objective:** Add the entity relationship table that powers graph-based retrieval.

**Steps:**
1. Create `schemas/graph-edges/schema.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS public.graph_edges (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     source_entity TEXT NOT NULL,
     source_type   TEXT NOT NULL,   -- 'Person' | 'Project' | 'Concept' | 'Place' | 'Event'
     relation_type TEXT NOT NULL,   -- 'RELATES_TO' | 'DEPENDS_ON' | 'ASSIGNED_TO' | 'MENTIONS' | etc.
     target_entity TEXT NOT NULL,
     target_type   TEXT NOT NULL,
     confidence    FLOAT NOT NULL DEFAULT 0.85 CHECK (confidence >= 0 AND confidence <= 1),
     edge_source   TEXT NOT NULL,   -- 'wikilink' | 'prose_extraction'
     source_thought_id UUID REFERENCES public.thoughts(id) ON DELETE SET NULL,
     created_at    TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE INDEX IF NOT EXISTS graph_edges_source_entity ON graph_edges (source_entity);
   CREATE INDEX IF NOT EXISTS graph_edges_target_entity ON graph_edges (target_entity);
   CREATE INDEX IF NOT EXISTS graph_edges_source_thought ON graph_edges (source_thought_id);
   CREATE INDEX IF NOT EXISTS graph_edges_confidence ON graph_edges (confidence DESC);
   ```
2. Create `schemas/graph-edges/metadata.json` following the OB1 schema metadata convention.
3. Deploy via Supabase Dashboard SQL Editor.
4. Verify table exists:
   ```bash
   node -e "const {createClient} = require('@supabase/supabase-js'); ..."
   # or use psql to confirm
   ```

**Dependencies:** None (standalone schema)  
**Time Estimate:** 30 minutes  
**Files:** `schemas/graph-edges/schema.sql` (new), `schemas/graph-edges/metadata.json` (new)

---

### Task B.2: Build Wikilink Edge Extractor

**Objective:** Mine the `metadata.wikilinks` field already stored on every Obsidian-imported thought
and write deterministic `graph_edges` rows (confidence = 1.0) for every resolved wikilink.

**Why this first:** Wikilinks are deterministic — no LLM required. They give us ~10,000 high-confidence
graph edges immediately from the existing 3,911 thoughts.

**Steps:**
1. Create `bin/extract-wikilink-edges.js`:
   - Query all thoughts where `metadata->>'source' = 'obsidian'` and `metadata->'wikilinks'` is non-null
   - For each thought, iterate `metadata.wikilinks[]`
   - Resolve each wikilink to a target thought by matching `metadata->>'title'`
   - Insert a `graph_edges` row: `source_entity = source title`, `target_entity = wikilink name`,
     `relation_type = 'WIKILINK'`, `confidence = 1.0`, `edge_source = 'wikilink'`, `source_thought_id = id`
   - Skip unresolvable wikilinks (log count at end)
   - Use `ON CONFLICT DO NOTHING` to make the script idempotent
2. Run against all 3,911 thoughts.
3. Log: total edges inserted, resolution rate (resolved / total wikilinks).

**Acceptance Test:**
```bash
node bin/extract-wikilink-edges.js
# → e.g. "Inserted 8,432 edges from 3,911 thoughts (87% resolution rate)"
```

**Dependencies:** Task B.1  
**Time Estimate:** 2 hours  
**Files:** `bin/extract-wikilink-edges.js` (new)

---

### Task B.3: Deploy Entity Extraction Worker (LLM-powered)

**Objective:** For each thought, use the local Ollama LLM to extract named entities and relationships,
then write `graph_edges` rows (confidence < 1.0) for prose-level connections.

**Approach:** Adapt OB1's community `integrations/entity-extraction-worker` recipe from NateOB1 to use
Ollama instead of OpenRouter. The schema and flow already match our `graph_edges` table.

**Steps:**
1. Copy the OB1 community recipe:
   ```bash
   # Clone the recipe from NateOB1 repo or manually copy relevant files
   cp -r /tmp/pi-github-repos/NateBJones-Projects/OB1@main/integrations/entity-extraction-worker \
         integrations/entity-extraction-worker
   ```
2. Read the recipe's README and adapt:
   - Replace OpenRouter API calls with Ollama calls (`http://localhost:11434/api/generate`)
   - Use `LOCAL_CHAT_MODEL` from `.env` (e.g., `qwen2.5:14b` or `llama3.2`)
   - Extraction prompt (structured JSON output):
     ```
     Extract all named entities and relationships from the following text.
     Return ONLY valid JSON in this exact format:
     {
       "entities": [{"name": string, "type": "Person|Project|Concept|Place|Event"}],
       "relations": [{"source": string, "type": string, "target": string, "confidence": number}]
     }
     Text: <thought content>
     ```
3. Confidence gate: only insert edges where `confidence >= 0.7`.
4. Entity name normalisation: apply `.trim().toLowerCase()` before insert; store display name in Title Case.
5. Write results to `graph_edges` with `edge_source = 'prose_extraction'`.
6. Run on a sample of 50 thoughts first; inspect output; tune prompt if needed.
7. Run full batch against all 3,911 thoughts (this will take significant time — run as background job).
8. Add to `integrations/obsidian-listener` as a post-ingest step for new notes.

**Acceptance Test:**
```bash
node integrations/entity-extraction-worker/run.js --limit 50 --verbose
# → entities extracted, relations with confidence >= 0.7 written to graph_edges
# → check Supabase: SELECT count(*), edge_source FROM graph_edges GROUP BY edge_source;
```

**Dependencies:** Task B.1, Ollama running with `qwen2.5:14b` or `llama3.2` pulled  
**Time Estimate:** 3–4 hours  
**Files:** `integrations/entity-extraction-worker/` (adapted from OB1 community recipe)

---

### Task B.4: Add Graph Traversal to Context Assembler

**Objective:** Extend `lib/context-assembler.js` to perform 1-hop graph expansion on top semantic hits,
surfacing connected thoughts that semantic search alone would miss.

**Steps:**
1. In `lib/context-assembler.js`, implement the `includeGraph: true` path:
   ```typescript
   // After semantic search returns topK chunks:
   const entityNames = extractEntitiesFromChunks(semanticHits); // extract source_entity values
   const neighbors = await supabase
     .from('graph_edges')
     .select('target_entity, relation_type, confidence, source_thought_id')
     .in('source_entity', entityNames)
     .gte('confidence', 0.7)
     .order('confidence', { ascending: false })
     .limit(10);

   // Fetch the actual thoughts for neighbor IDs (deduplicated against semantic hits)
   const neighborThoughts = await fetchThoughtsByIds(neighbors.map(n => n.source_thought_id));
   ```
2. Append graph neighbors to the context block with a clear header:
   ```
   [Graph Expansion: Kim → ASSIGNED_TO → Project Alpha (confidence: 0.91)]
   {neighbor thought content}
   ```
3. Enable via `--graph` flag in `query-brain.js`:
   ```bash
   node bin/query-brain.js "what did Kim ask me to do?" --answer --graph
   ```
4. Add relation summary line to the answer context:
   ```
   [Relationships found: Kim ASSIGNED_TO Project Alpha | Project Alpha DEPENDS_ON Backend Refactor]
   ```

**Acceptance Test:**
```bash
node bin/query-brain.js "walk me through the dependencies from the last Kim meeting" --answer --graph
# → answer uses both direct semantic hits AND graph-expanded neighbor thoughts
# → relationship types shown in context block
```

**Dependencies:** Tasks A.3, B.2, B.3  
**Time Estimate:** 2 hours  
**Files:** `lib/context-assembler.js` (update), `bin/query-brain.js` (add `--graph` flag)

---

## Phase C: Wiki Synthesis Layer 🔧 NEXT — Priority: High

> **Vision (ArchDoc):** The LLM maintains a persistent, growing synthesis layer — one page per entity,
> concept, and key synthesis. Every query can read these pages as pre-computed context.
> Unlike RAG chunks (raw notes), wiki pages are *distilled understanding*.

---

### Task C.1: Deploy `wiki_pages` Schema

**Objective:** Add the table that stores LLM-synthesised wiki pages for entities, concepts, and answers.

**Steps:**
1. Create `schemas/wiki-pages/schema.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS public.wiki_pages (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     slug         TEXT UNIQUE NOT NULL,  -- e.g. 'person/kim', 'concept/deep-work', 'synthesis/masters-vs-blog'
     title        TEXT NOT NULL,
     content      TEXT NOT NULL,          -- LLM-written markdown
     page_type    TEXT NOT NULL CHECK (page_type IN ('entity', 'concept', 'synthesis', 'answer')),
     source_thought_ids UUID[] DEFAULT '{}',
     embedding    vector(2560),           -- dimension must match EMBEDDING_DIMENSIONS in .env
     created_at   TIMESTAMPTZ DEFAULT NOW(),
     updated_at   TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE INDEX IF NOT EXISTS wiki_pages_slug ON wiki_pages (slug);
   CREATE INDEX IF NOT EXISTS wiki_pages_type ON wiki_pages (page_type);
   CREATE INDEX IF NOT EXISTS wiki_pages_hnsw
     ON wiki_pages USING hnsw (embedding vector_cosine_ops)
     WITH (m = 16, ef_construction = 64);
   CREATE INDEX IF NOT EXISTS wiki_pages_fts
     ON wiki_pages USING gin (to_tsvector('english', content));
   ```
2. Create `schemas/wiki-pages/metadata.json`.
3. Deploy via Supabase Dashboard.

**Dependencies:** Task A.1 (embedding consistency verified)  
**Time Estimate:** 30 minutes  
**Files:** `schemas/wiki-pages/schema.sql` (new), `schemas/wiki-pages/metadata.json` (new)

---

### Task C.2: Adapt OB1 Wiki-Synthesis and Entity-Wiki Recipes

**Objective:** Use the NateOB1 community recipes `wiki-synthesis` and `entity-wiki` as the engine
for populating `wiki_pages`, adapted for local Ollama instead of OpenRouter.

**Steps:**
1. Copy both recipes:
   ```bash
   cp -r /tmp/pi-github-repos/NateBJones-Projects/OB1@main/recipes/wiki-synthesis recipes/wiki-synthesis
   cp -r /tmp/pi-github-repos/NateBJones-Projects/OB1@main/recipes/entity-wiki    recipes/entity-wiki
   ```
2. Read both READMEs fully before modifying anything.
3. Adapt `wiki-synthesis`:
   - Replace OpenRouter with Ollama (`LOCAL_CHAT_MODEL` from `.env`)
   - Target the `wiki_pages` table (slug, content, page_type = 'synthesis')
   - Embed generated pages via `LOCAL_LLM_BASE_URL` / `LOCAL_EMBEDDING_MODEL` before insert
4. Adapt `entity-wiki`:
   - Extract top entities from `graph_edges` (by edge frequency)
   - For each entity, fetch all related thought chunks (via `source_thought_id`)
   - Prompt the local LLM to produce a synthesis page: who/what this entity is, key facts, cross-references
   - Insert as `page_type = 'entity'` in `wiki_pages`
5. Create `bin/build-wiki.js` as the unified entry point:
   ```bash
   node bin/build-wiki.js --type entity   # generate/refresh all entity pages
   node bin/build-wiki.js --type synthesis # generate cross-domain synthesis pages
   node bin/build-wiki.js --slug person/kim # refresh a specific page
   ```
6. Run on the top 20 most-connected entities from `graph_edges` as a pilot.
7. Inspect output in Supabase `wiki_pages` table — verify quality.

**Acceptance Test:**
```bash
node bin/build-wiki.js --type entity --limit 20
# → 20 rows in wiki_pages with page_type='entity'
# → content is coherent markdown with cross-references to other entities
# → embeddings populated (dims = EMBEDDING_DIMENSIONS, e.g. 2560)
```

**Dependencies:** Tasks C.1, B.3 (entities in graph_edges), A.1  
**Time Estimate:** 3–4 hours  
**Files:** `recipes/wiki-synthesis/` (adapted), `recipes/entity-wiki/` (adapted), `bin/build-wiki.js` (new)

---

### Task C.3: Hook Wiki Update into Obsidian Listener (Post-Ingest Trigger)

**Objective:** After any new or updated note is ingested via `integrations/obsidian-listener`,
automatically trigger a wiki refresh for any entity page affected by the new content.

**Steps:**
1. In `integrations/obsidian-listener/process-file.js`, after the ingest completes:
   - Extract the entities mentioned in the new thought (from `graph_edges` where `source_thought_id = newThoughtId`)
   - Call `bin/build-wiki.js --slug entity/<name>` for each affected entity (max 5 per ingest to limit LLM calls)
   - Log: `[wiki-update] Refreshed 3 entity pages after ingest of "Meeting with Kim 2026-07-14.md"`
2. Gate the trigger behind an env flag `WIKI_AUTO_UPDATE=true` so it can be disabled for bulk ingest runs.
3. Append a one-line entry to `docs/wiki-log.md` (create if absent):
   ```
   ## [2026-07-14] ingest | Meeting with Kim 2026-07-14.md | refreshed: person/kim, project/project-alpha
   ```

**Dependencies:** Tasks C.2, B.3  
**Time Estimate:** 1.5 hours  
**Files:** `integrations/obsidian-listener/process-file.js` (update), `docs/wiki-log.md` (auto-created)

---

### Task C.4: Add Wiki Lookup to Context Assembler

**Objective:** Complete the 3-stage retrieval pipeline by adding wiki page lookup to
`lib/context-assembler.js`. Queries now draw on raw chunks (Stage 1) + graph neighbors (Stage 2) +
synthesised wiki pages (Stage 3).

**Steps:**
1. In `lib/context-assembler.js`, implement the `includeWiki: true` path:
   ```typescript
   // Embed the query and search wiki_pages by cosine similarity
   const wikiHits = await supabase.rpc('match_wiki_pages', {
     query_embedding: queryEmbedding,
     match_threshold: 0.3,
     match_count: 3
   });

   // Also: text-match wiki page titles against extracted entities from the query
   const entityMatches = await supabase
     .from('wiki_pages')
     .select('slug, title, content, page_type')
     .textSearch('content', queryTerms, { type: 'websearch' })
     .limit(2);
   ```
2. Add the `match_wiki_pages` RPC function to `schemas/wiki-pages/schema.sql`:
   ```sql
   CREATE OR REPLACE FUNCTION match_wiki_pages(
     query_embedding vector(2560),           -- must match EMBEDDING_DIMENSIONS in .env
     match_threshold float DEFAULT 0.3,
     match_count int DEFAULT 3
   )
   RETURNS TABLE (id UUID, slug TEXT, title TEXT, content TEXT, page_type TEXT, similarity float)
   LANGUAGE sql STABLE AS $$
     SELECT id, slug, title, content, page_type,
            1 - (embedding <=> query_embedding) AS similarity
     FROM wiki_pages
     WHERE 1 - (embedding <=> query_embedding) > match_threshold
     ORDER BY similarity DESC
     LIMIT match_count;
   $$;
   ```
3. Prepend wiki content to context block with header:
   ```
   [Wiki: Kim (Person) — synthesised from 14 notes]
   {wiki page content}
   ```
4. Enable via `--wiki` flag in `query-brain.js`:
   ```bash
   node bin/query-brain.js "what is my relationship with Kim?" --answer --graph --wiki
   ```

**Acceptance Test:**
```bash
node bin/query-brain.js "what's the status of Project Alpha?" --answer --graph --wiki
# → answer draws on semantic chunks + graph edges + wiki entity page for Project Alpha
# → three context sections visible in verbose output
```

**Dependencies:** Tasks A.3, B.4, C.2  
**Time Estimate:** 2 hours  
**Files:** `lib/context-assembler.js` (update), `schemas/wiki-pages/schema.sql` (add RPC), `bin/query-brain.js` (add `--wiki` flag)

---

## Phase D: Accumulated Learnings ⏳ LATER — Priority: Medium

> **Vision (ArchDoc):** After sessions accumulate, the system runs a background job that reviews
> recent queries + answers and asks: *"What patterns, contradictions, or cross-domain connections
> emerge that no single note contains?"* This is the **unique differentiator** vs. NateOB1 —
> not present anywhere in the community ecosystem.

---

### Task D.1: Deploy `learnings` Schema

**Objective:** Add the table that stores cross-session insights generated by the accumulator job.

**Steps:**
1. Create `schemas/learnings/schema.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS public.learnings (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     title             TEXT NOT NULL,
     insight           TEXT NOT NULL,         -- LLM-generated cross-session insight
     related_thought_ids UUID[] DEFAULT '{}',
     related_entities  TEXT[] DEFAULT '{}',
     related_wiki_slugs TEXT[] DEFAULT '{}',
     confidence        FLOAT CHECK (confidence >= 0 AND confidence <= 1),
     learning_type     TEXT NOT NULL DEFAULT 'pattern' CHECK (
       learning_type IN ('pattern', 'contradiction', 'connection', 'gap', 'trend')
     ),
     session_window_start TIMESTAMPTZ,
     session_window_end   TIMESTAMPTZ,
     generated_at      TIMESTAMPTZ DEFAULT NOW(),
     dismissed_at      TIMESTAMPTZ  -- user can dismiss learnings they disagree with
   );

   CREATE INDEX IF NOT EXISTS learnings_type ON learnings (learning_type);
   CREATE INDEX IF NOT EXISTS learnings_generated ON learnings (generated_at DESC);
   CREATE INDEX IF NOT EXISTS learnings_confidence ON learnings (confidence DESC);
   ```
2. Also create a `query_sessions` table to log queries for the accumulator to review:
   ```sql
   CREATE TABLE IF NOT EXISTS public.query_sessions (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     query        TEXT NOT NULL,
     answer       TEXT,
     thought_ids  UUID[] DEFAULT '{}',
     wiki_slugs   TEXT[] DEFAULT '{}',
     model_used   TEXT,
     filed_as_wiki BOOLEAN DEFAULT FALSE,
     created_at   TIMESTAMPTZ DEFAULT NOW()
   );
   ```
3. Deploy both tables via Supabase Dashboard.
4. Update `bin/query-brain.js` to log every `--answer` session to `query_sessions`.

**Dependencies:** Phase A complete  
**Time Estimate:** 45 minutes  
**Files:** `schemas/learnings/schema.sql` (new), `bin/query-brain.js` (add session logging)

---

### Task D.2: Build Learnings Accumulator Script

**Objective:** `bin/accumulate-learnings.js` — a script that reviews recent query sessions and
wiki pages and asks the local LLM to surface cross-domain patterns, contradictions, and gaps.

**Steps:**
1. Create `bin/accumulate-learnings.js`:
   ```typescript
   // 1. Fetch the last N query sessions (default: last 7 days or 30 sessions)
   const recentSessions = await supabase
     .from('query_sessions')
     .select('query, answer, wiki_slugs, thought_ids')
     .gte('created_at', sevenDaysAgo)
     .order('created_at', { ascending: false })
     .limit(30);

   // 2. Fetch the wiki pages referenced in those sessions
   // 3. Build a summary context of: queries asked, answers given, entities touched

   // 4. Prompt the local LLM:
   const ACCUMULATOR_PROMPT = `
   You are reviewing a personal knowledge graph owner's recent query sessions.
   Based on the queries, answers, and knowledge pages below, identify:
   1. PATTERNS — recurring themes across multiple sessions
   2. CONTRADICTIONS — cases where notes or answers conflict
   3. CONNECTIONS — links between domains the user hasn't explicitly drawn
   4. GAPS — important topics that appear to be under-documented
   5. TRENDS — how the user's thinking seems to be evolving

   For each finding, provide:
   - title: short label (max 10 words)
   - insight: 2-4 sentence explanation
   - type: pattern | contradiction | connection | gap | trend
   - confidence: 0.0 to 1.0
   - related_entities: list of entity names involved

   Return as a JSON array. Only include findings with confidence >= 0.6.
   `;

   // 5. Parse LLM response → insert rows into learnings table
   // 6. Print summary to stdout
   ```
2. Add a `--dry-run` flag that prints learnings without inserting them.
3. Add a `--since` flag: `--since 2026-07-01` to scope the window.
4. Run manually to verify output quality before scheduling.

**Acceptance Test:**
```bash
node bin/accumulate-learnings.js --dry-run --since 2026-07-01
# → prints 3-7 learnings with type, confidence, title, insight
# → at least 1 "connection" type linking two different domains
# → no obvious hallucinations (all claims traceable to session context)
```

**Dependencies:** Task D.1  
**Time Estimate:** 3 hours  
**Files:** `bin/accumulate-learnings.js` (new)

---

### Task D.3: Expose Learnings in Query Engine and MCP

**Objective:** Make the learnings layer queryable — both from the CLI and from MCP clients.

**Steps:**
1. Add `--learnings` flag to `query-brain.js`:
   ```bash
   # Show recent learnings matching the query topic
   node bin/query-brain.js "masters thesis" --learnings
   # → prints relevant accumulated insights about this topic
   ```
2. In `lib/context-assembler.js`, add optional learnings injection:
   - If a learning's `related_entities` overlaps with the query's entities → inject it into context
   - Prepend with:
     ```
     [Accumulated Learning: connection — confidence 0.82]
     Your notes on "masters thesis" and "blog writing" share a recurring theme of...
     ```
3. Add MCP tool `list_learnings` to the Supabase Edge Function (`open-brain-mcp`):
   - Input: optional `type` filter, optional `since` date
   - Output: array of recent learnings sorted by confidence DESC
4. Add MCP tool `file_answer_to_wiki` — save the current `--answer` output as a `wiki_pages` row
   with `page_type = 'answer'`:
   ```bash
   node bin/query-brain.js "how does my thesis relate to my blog?" --answer --wiki --save
   # → saves answer as wiki_pages slug 'answer/thesis-vs-blog-YYYYMMDD'
   ```

**Dependencies:** Tasks C.4, D.2  
**Time Estimate:** 2–3 hours  
**Files:** `lib/context-assembler.js`, `bin/query-brain.js`, `supabase/functions/open-brain-mcp/` (update)

---

## Phase 2: Extensions Learning Path ⏳ DEFERRED — Priority: Medium

> Begin after Phase A is complete. Extensions compound on top of a working query engine.

### Task 2.1: Household Knowledge Base (Extension #1)
Extension from OB1 learning path. Teaches schema design, RLS, and MCP tool patterns.
Copy from `NateBJones-Projects/OB1/extensions/household-knowledge/`, deploy, add MCP tools.
**Dependencies:** Phase A complete | **Time Estimate:** 2 hours

### Task 2.2: Home Maintenance Tracker (Extension #2)
Time-based data model, recurring schedules, cross-table joins.
Copy from `NateBJones-Projects/OB1/extensions/home-maintenance/`, deploy, add MCP tools.
**Dependencies:** Task 2.1 | **Time Estimate:** 2–3 hours

---

## Phase 3: Data Import & Quality ⏳ Priority: High (parallel with Phase B)

### Task 3.1: Deploy ChatGPT Conversation Import
Import historical ChatGPT conversations. Copy recipe from `NateBJones-Projects/OB1/recipes/chatgpt-conversation-import/`.
Configure to use `LOCAL_EMBEDDING_MODEL` / `LOCAL_LLM_BASE_URL` (set in `.env`); run after Task A.1 confirms embedding consistency.
**Dependencies:** Task A.1 | **Time Estimate:** 1 hour

### Task 3.2: Deploy Fingerprint Dedup Backfill
Add content fingerprints to existing thoughts and remove duplicates.
Copy from `NateBJones-Projects/OB1/recipes/fingerprint-dedup-backfill/`.
**Dependencies:** `smart-ingest` schema (already deployed) | **Time Estimate:** 1 hour

---

## Phase 4: Local LLM Integration Hardening ⏳ Priority: High

### Task 4.1: Verify Full Local Stack
Confirm all components (embedding, extraction, generation, wiki synthesis) use Ollama exclusively.
Audit `.env` and all scripts for any remaining OpenRouter calls.
Update `integrations/obsidian-listener` to use local Ollama for embeddings (currently uses OpenRouter).
**Dependencies:** Task A.1 | **Time Estimate:** 1 hour

### Task 4.2: Configure Cursor / Claude Code MCP Integration
Wire the MCP server to Cursor/Claude Code for in-editor access to the knowledge graph.
**Dependencies:** Phase A complete | **Time Estimate:** 30 minutes

---

## Phase 5: Web Dashboard ⏳ Priority: Medium

### Task 5.1: Deploy Open Brain Dashboard (Next.js)
Copy `NateBJones-Projects/OB1/dashboards/open-brain-dashboard-next/`.
Configure for local Supabase. Add wiki pages and learnings browsing panels beyond the base OB1 dashboard.
**Dependencies:** Phases A + C complete (wiki pages make the dashboard significantly more useful)  
**Time Estimate:** 2–3 hours

---

## Phase 6: Capture Integrations ⏳ Priority: Medium

### Task 6.1: Slack Capture Integration
Copy `integrations/slack-capture/` from NateOB1. Deploy Slack webhook Edge Function.
**Time Estimate:** 2 hours

### Task 6.2: Discord Capture Integration
Copy `integrations/discord-capture/` from NateOB1. Deploy Discord bot.
**Time Estimate:** 1.5 hours

---

## Phase 7: Advanced Extensions ⏳ Priority: Low

### Task 7.1: Professional CRM (Extension #5)
Contact tracking integrated with thoughts and graph_edges.
`extensions/professional-crm/` from NateOB1. CRM contacts become first-class entities in the graph.
**Dependencies:** Phase B complete (entity graph makes CRM far more powerful)

### Task 7.2: Family Calendar (Extension #3)
Multi-person schedule coordination.
**Dependencies:** Task 2.2

---

## Phase 8: Advanced Recipes & Workflows ⏳ Priority: Low

### Task 8.1: Daily Digest
Automated daily summary of recent thoughts + learnings delta.
Copy `recipes/daily-digest/` from NateOB1. Extend to include new learnings from the previous day.
**Dependencies:** Phase D complete

### Task 8.2: Life Engine
Proactive briefings, habits, health from `recipes/life-engine/`.
**Dependencies:** Phase D (learnings give the Life Engine cross-domain awareness)

---

## Success Metrics

### Phase A Complete (Query Engine)
- ✓ All thoughts share a single embedding model (`LOCAL_EMBEDDING_MODEL`) at consistent dimensions (`EMBEDDING_DIMENSIONS`)
- ✓ Every `--answer` response cites source note titles in `[brackets]`
- ✓ `lib/context-assembler.js` in place with stub hooks for graph + wiki
- ✓ No hallucination on out-of-context queries (returns "I don't have enough information")

### Phase B Complete (Graph Layer)
- ✓ `graph_edges` table deployed with HNSW index on entity columns
- ✓ Wikilink edges extracted: ≥ 5,000 edges at confidence = 1.0
- ✓ Prose extraction edges: ≥ 10,000 edges at confidence ≥ 0.7
- ✓ `--graph` flag expands retrieval via 1-hop traversal

### Phase C Complete (Wiki Synthesis)
- ✓ `wiki_pages` table deployed
- ✓ ≥ 50 entity pages synthesised and embedded
- ✓ `--wiki` flag pulls synthesised pages into context
- ✓ Post-ingest trigger refreshes affected entity pages automatically
- ✓ `docs/wiki-log.md` being maintained

### Phase D Complete (Accumulated Learnings)
- ✓ `learnings` + `query_sessions` tables deployed
- ✓ `bin/accumulate-learnings.js` producing non-trivial cross-domain insights
- ✓ Learnings injected into context assembler when relevant
- ✓ `list_learnings` MCP tool live

### Full System Complete
- ✓ All 6 core extensions deployed
- ✓ Dashboard operational with wiki + learnings panels
- ✓ 2+ capture sources configured (Slack, Discord)
- ✓ 5,000+ thoughts with rich metadata + graph edges + wiki pages
- ✓ Weekly `accumulate-learnings` run producing compounding insights

---

## Immediate Next Actions (Phase A)

1. **Check current embedding dimensions** (5 min) — run the SQL in Task A.1 Step 1 to confirm whether a re-embed is needed.
2. **Verify local LLM server** (5 min) — confirm `LOCAL_LLM_BASE_URL` is reachable and `LOCAL_EMBEDDING_MODEL` is loaded
3. **Write `bin/reembed-thoughts.js`** (2–3 hours) — Task A.1
4. **Add grounding prompt** (1 hour) — Task A.2
5. **Refactor to `lib/context-assembler.js`** (1.5 hours) — Task A.3

**Estimated time to Phase A complete:** ~6 hours of focused work  
**Estimated time to Phase B+C complete:** ~15 additional hours  
**Estimated time to Phase D complete:** ~5 additional hours

---

## Architecture Reference

For the full design rationale behind Phases A–D, see:
- `analysis-openbrain-viability.md` — viability analysis (risks, benefits, problems, gap analysis)
- `OpenBrain  Architecture Document for a Local Personal AI Second Brain.md` — original ArchDoc vision

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
  → Grounded generation → Ollama (qwen2.5:14b / llama3.2)
                           strict: "answer ONLY from context"
  → Session logged → query_sessions table
  → Optionally filed → wiki_pages (page_type = 'answer')
─────────────────────────────────────────────────────
```

---

## References

- [Original OB1 Repository](https://github.com/NateBJones-Projects/OB1)
- [OB1 Getting Started Guide](https://github.com/NateBJones-Projects/OB1/blob/main/docs/01-getting-started.md)
- [OB1 Entity Extraction Worker](https://github.com/NateBJones-Projects/OB1/tree/main/integrations/entity-extraction-worker)
- [OB1 Wiki Synthesis Recipe](https://github.com/NateBJones-Projects/OB1/tree/main/recipes/wiki-synthesis)
- [OB1 Entity Wiki Recipe](https://github.com/NateBJones-Projects/OB1/tree/main/recipes/entity-wiki)
- Local analysis: `analysis-openbrain-viability.md`
- Local ArchDoc: `OpenBrain  Architecture Document for a Local Personal AI Second Brain.md`
- Local primitives: `primitives/README.md`
- Local schemas: `schemas/README.md`

---

**Last Updated:** 2026-07-14  
**Status:** Phase A — IN PROGRESS  
**Maintainer:** OB1 Orchestrator (pi)
