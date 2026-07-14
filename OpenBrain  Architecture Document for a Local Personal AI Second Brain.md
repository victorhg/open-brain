# OpenBrain: Local Personal AI for Your Second Brain

**Project Codename:** `openbrain`
**Implementation Agent:** pi-dev
**Author:** Victor Hugo Germano
**Date:** July 2026

***

## Executive Summary

OpenBrain is a fully local, privacy-first infrastructure that transforms an Obsidian Second Brain (2,000+ markdown notes) into a conversational, reasoning-capable AI system. It goes beyond traditional RAG (Retrieval-Augmented Generation) by building a **persistent, compounding knowledge layer** — a heuristic graph and a wiki-like synthesis — that accumulates understanding over time rather than rediscovering it on every query. All inference happens on local LLMs via Ollama. No note leaves the machine. Supabase (self-hosted or local Docker) with `pgvector` serves as the storage and vector search backend.[^1][^2][^3][^4]

The key design insight, adapted from Karpathy's LLM Wiki pattern, is that the brain does not merely retrieve — it **builds**. When you ingest a note, the system reads, extracts entities, integrates new knowledge into the wiki layer, flags contradictions, and updates the heuristic graph. When you ask a question, the answer can be filed back as a new wiki page — making every conversation compound into permanent knowledge.[^5]

***

## Core Design Principles

1. **Local-first sovereignty** — zero data leaves the machine; all LLM calls go to Ollama
2. **Compounding knowledge** — the wiki layer grows richer with every interaction, not just at index time[^2]
3. **Hybrid graph** — deterministic wikilink edges (high-confidence) + LLM-extracted entity edges (prose-level)[^6]
4. **MCP extensibility** — exposes a Model Context Protocol server so the knowledge base can be wired to any future LLM provider or agent harness[^7][^8]
5. **Supabase pgvector** — all embeddings, graph edges, wiki pages, and learned insights stored in Postgres with the `vector` extension[^3][^9]

***

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        OBSIDIAN VAULT                           │
│          ~/notes/ (2000+ .md files, wikilinks, tags)            │
└─────────────────────────┬───────────────────────────────────────┘
                          │  File Watcher / Manual Ingest
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INGEST PIPELINE (Python)                      │
│  1. Parse → resolve [[wikilinks]], extract frontmatter/tags      │
│  2. Chunk → heading-based (≤240 tokens), safety cap 3000 chars   │
│  3. Embed → Ollama (mxbai-embed-large, local)                    │
│  4. Entity Extract → Ollama LLM (prose NER + relation triples)   │
│  5. Wiki Update → merge entities, update synthesis pages         │
└────────────┬──────────────────────────┬────────────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────────┐  ┌──────────────────────────────────┐
│   SUPABASE (pgvector)  │  │     WIKI LAYER (Markdown files)  │
│                        │  │  ~/openbrain/wiki/               │
│  • note_chunks         │  │  ├── index.md                    │
│  • embeddings (vector) │  │  ├── log.md                      │
│  • graph_edges         │  │  ├── entities/                   │
│  • wiki_pages          │  │  ├── concepts/                   │
│  • learnings           │  │  └── syntheses/                  │
│  • mcp_sessions        │  │  (LLM writes, human reads)       │
└────────────┬───────────┘  └──────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    QUERY ENGINE (Python FastAPI)                  │
│  1. Embed question → semantic search (pgvector cosine)           │
│  2. Graph traversal → expand via entity edges (multi-hop)        │
│  3. Wiki lookup → read synthesis pages via index.md              │
│  4. Context assembly → ranked chunks + graph neighbors + wiki    │
│  5. LLM generate → Ollama (local model, grounded prompt)         │
│  6. File answer → optionally save response as wiki page          │
└────────────┬──────────────────────────┬────────────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────────┐  ┌──────────────────────────────────┐
│   CHAT INTERFACE       │  │     MCP SERVER                   │
│   (CLI / local webapp) │  │  Exposes tools:                  │
│                        │  │  • search_vault                  │
│  Ask: "What's the      │  │  • query_graph                   │
│  relationship between  │  │  • get_wiki_page                 │
│  my masters and blog?" │  │  • list_learnings                │
│                        │  │  Enables Claude Desktop, Cursor, │
│                        │  │  or any MCP-compatible client    │
└────────────────────────┘  └──────────────────────────────────┘
```

***

## Layer-by-Layer Specification

### Layer 1 — Raw Sources (Immutable)

The Obsidian vault is read-only from OpenBrain's perspective. Files are ingested but never modified. This ensures your vault remains your authoritative source of truth.[^2]

- **Format:** `.md` files with YAML frontmatter, `[[wikilinks]]`, `#tags`
- **Watcher:** `watchdog` Python library monitors vault for file changes
- **Trigger:** On change → re-ingest modified file (hash comparison to skip unchanged files)[^10]

### Layer 2 — Ingest Pipeline

#### 2.1 Parsing

Obsidian's wikilink syntax (`[[Note Name]]`, `[[target|alias]]`, `![[embed]]`) is resolved to clean display text before embedding[^2]. Raw brackets produce noise in the vector space; resolved display text captures semantic meaning[^2].

```python
# core pattern (adapted from vask / obsidian-graph pipelines)
WIKILINK_PATTERN = re.compile(r"(!)?\\[\\[([^\\]]+)\\]\\]")
# → resolve to display text, store link metadata separately
```

Frontmatter is parsed into structured metadata (tags, dates, aliases, type). Body text flows into chunking as clean prose.

#### 2.2 Chunking Strategy

Based on empirical evaluation of 770-note vaults, **heading-based chunking (≤240 tokens) outperforms whole-note chunking by 14+ percentage points** in retrieval hit rate. Each chunk carries its full heading path prepended:

```
Mentoring Session with Kim > Dependencies > Action Items
hunk body>
```

A safety cap of 3,000 characters catches dense tables, code blocks, and URL-heavy notes that overflow the embedding context window.

#### 2.3 Local Embedding

All embeddings are generated locally via Ollama, using `mxbai-embed-large` — which improves retrieval hit rate by 7–18 percentage points over `nomic-embed-text` depending on query type.

```bash
ollama pull mxbai-embed-large
```

Vector dimensions: **1024** (mxbai-embed-large). Stored in Supabase `note_chunks.embedding` as `vector(1024)` with HNSW index for fast cosine similarity.

#### 2.4 Entity Extraction (LLM-powered)

After chunking, each chunk is passed to a local Ollama LLM (e.g., `llama3.2`, `qwen2.5:14b`) with a structured extraction prompt:

```
Extract entities and relationships from this text.
Return JSON: {
  entities: [{type: "Person|Project|Concept|Place|Event", name, source_span}],
  relations: [{type, source_entity, target_entity, source_span}]
}
Text: hunk>
```

This creates a **prose-extraction graph layer** on top of the deterministic wikilink graph. The combination — wikilink edges as high-confidence skeleton, prose edges as medium-confidence enrichment — is the production-grade hybrid that answers questions no page-link graph can.

#### 2.5 Wiki Update

After entity extraction, the local LLM updates the wiki layer:

1. Reads the relevant entity pages (Person, Project, Concept)
2. Updates summaries, cross-references, and notes contradictions
3. Appends an entry to `wiki/log.md` (date, source note, pages touched)
4. Updates `wiki/index.md` with any new pages

A single ingested note can touch 10–15 wiki pages.

***

### Layer 3 — Supabase Database Schema

All state is stored in Supabase (local Docker or managed). `pgvector` is the vector search engine.

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- for full-text search

-- Raw note chunks + embeddings
CREATE TABLE note_chunks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_path   TEXT NOT NULL,           -- relative path in vault
  note_title  TEXT,
  heading_path TEXT[],                  -- ['H1', 'H2', 'H3']
  content     TEXT NOT NULL,
  content_hash TEXT NOT NULL,           -- SHA-256 for change detection
  embedding   vector(1024),             -- mxbai-embed-large
  tags        TEXT[],
  frontmatter JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX note_chunks_hnsw ON note_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX note_chunks_fts ON note_chunks
  USING gin (to_tsvector('english', content));

-- Heuristic knowledge graph
CREATE TABLE graph_edges (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_entity TEXT NOT NULL,
  source_type   TEXT NOT NULL,           -- Person, Project, Concept, etc.
  relation_type TEXT NOT NULL,           -- DEPENDS_ON, RELATES_TO, etc.
  target_entity TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  confidence    FLOAT DEFAULT 0.85,      -- 1.0 for wikilinks, <1 for prose
  edge_source   TEXT,                    -- 'wikilink' | 'prose_extraction'
  source_chunk  UUID REFERENCES note_chunks(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Wiki synthesis layer
CREATE TABLE wiki_pages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,      -- e.g., 'person/kim', 'concept/masters'
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,             -- LLM-written markdown
  page_type   TEXT NOT NULL,             -- 'entity' | 'concept' | 'synthesis' | 'answer'
  source_notes TEXT[],                   -- vault paths that contributed
  embedding   vector(1024),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Accumulated learnings (LLM-generated insights over time)
CREATE TABLE learnings (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT NOT NULL,
  insight      TEXT NOT NULL,
  related_notes TEXT[],
  related_concepts TEXT[],
  confidence   FLOAT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  session_id   UUID
);

-- MCP session log
CREATE TABLE mcp_sessions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query      TEXT NOT NULL,
  answer     TEXT,
  chunks_used UUID[],
  wiki_pages_used TEXT[],
  model_used TEXT,
  filed_to_wiki BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

***

### Layer 4 — Query Engine

The query pipeline uses a **three-stage retrieval + generation** pattern:

#### Stage 1: Parallel Retrieval
- **Semantic search** — embed query with `mxbai-embed-large` → cosine similarity in `note_chunks` (top-k=6, threshold=0.25)
- **Wiki lookup** — query `wiki_pages` index for matching entities/concepts
- **Graph traversal** — expand top-retrieved notes via `graph_edges` (1-hop neighbors)

#### Stage 2: Context Assembly
Ranked and deduplicated context is assembled with provenance:
```
[Source: Mentoring Session with Kim, 2026-07-02]
hunk content>

[Wiki: Kim (Person)]
<LLM-synthesized profile of Kim>

[Graph: Kim → ASSIGNED_TO → Project Alpha; Project Alpha → DEPENDS_ON → Backend Refactor]
```

#### Stage 3: Grounded Generation
The local LLM (Ollama) generates the answer with a strict grounding prompt:

```
Answer using ONLY the provided vault context.
If the context is insufficient, say so plainly.
Cite source note titles inline in square brackets.
Never hallucinate information not present in the context.

Context:
<assembled context>

Question: <user query>
```

Example interactions this architecture supports:

- *"What's the relationship between my masters and my blog?"* → Graph traversal finds shared concept nodes (e.g., `writing`, `research`, `audience`) across both note clusters; wiki synthesis page for each is assembled as context.
- *"Walk me through the dependencies and actions from last week's Mentoring session with Kim"* → Semantic search + heading-path chunking surfaces the meeting note sections; graph edges expand to linked projects and action items; grounded answer with citations.

***

### Layer 5 — Accumulated Learnings

This is the **compounding differentiator** that separates OpenBrain from simple RAG. After each session, the system runs a background job:

1. Reviews the last N interactions (queries + answers) in `mcp_sessions`
2. Asks the local LLM: *"What patterns, contradictions, or insights emerge from these interactions that weren't explicitly in any single note?"*
3. Stores the result as a `learnings` entry in Supabase
4. Optionally creates a new `wiki/syntheses/` page

Over time, the system builds a meta-layer of understanding about the Second Brain — connections between domains, recurring themes, unresolved tensions between old and new beliefs.

A lint job (weekly or on-demand) scans for orphan wiki pages, stale claims, and important concepts lacking their own page.

***

### Layer 6 — MCP Server (Extensibility)

The MCP server exposes OpenBrain's knowledge base as a set of tools callable by any MCP-compatible LLM client (Claude Desktop, Cursor, OpenCode, etc.):

```python
# Tools exposed via MCP
tools = [
  "search_vault",           # semantic search over note_chunks
  "query_graph",            # traverse graph_edges by entity
  "get_wiki_page",          # read a synthesis wiki page
  "list_learnings",         # return recent accumulated insights
  "ingest_note",            # trigger ingest pipeline for a note path
  "file_answer_to_wiki",    # persist a query answer as a wiki page
]
```

This means: if you migrate to a different LLM provider (e.g., move from local Ollama to a hosted model), you connect the MCP server to your new client and the entire knowledge base migrates with zero changes to the data layer.

***

## Project Structure

```
openbrain/
├── AGENTS.md                  # schema + conventions (pi-dev reads this)
├── README.md
├── docker-compose.yml         # Supabase local + Ollama (if containerized)
├── .env.example
│
├── openbrain/                 # Python package
│   ├── __init__.py
│   ├── config.py              # vault path, DB URL, model config
│   │
│   ├── ingest/
│   │   ├── __init__.py
│   │   ├── watcher.py         # watchdog file monitor
│   │   ├── parser.py          # markdown parse, wikilink resolve
│   │   ├── chunker.py         # heading-based chunking
│   │   ├── embedder.py        # Ollama embedding calls
│   │   ├── extractor.py       # entity/relation extraction via LLM
│   │   └── wiki_updater.py    # update wiki layer
│   │
│   ├── store/
│   │   ├── __init__.py
│   │   ├── db.py              # Supabase client, connection pool
│   │   ├── chunks.py          # CRUD for note_chunks
│   │   ├── graph.py           # CRUD for graph_edges
│   │   ├── wiki.py            # CRUD for wiki_pages
│   │   └── learnings.py       # CRUD for learnings
│   │
│   ├── query/
│   │   ├── __init__.py
│   │   ├── retriever.py       # semantic + graph + wiki retrieval
│   │   ├── assembler.py       # context ranking and assembly
│   │   └── generator.py       # LLM generation with grounding prompt
│   │
│   ├── learner/
│   │   ├── __init__.py
│   │   ├── accumulator.py     # post-session insight generation
│   │   └── linter.py          # wiki health check
│   │
│   ├── mcp/
│   │   ├── __init__.py
│   │   └── server.py          # MCP server (FastMCP or mcp-python)
│   │
│   └── api/
│       ├── __init__.py
│       └── main.py            # FastAPI app (chat endpoint + admin)
│
├── wiki/                      # LLM-managed wiki layer
│   ├── index.md               # catalog of all wiki pages
│   ├── log.md                 # append-only ingest + query log
│   ├── entities/
│   ├── concepts/
│   └── syntheses/
│
├── scripts/
│   ├── ingest_vault.py        # bulk ingest CLI
│   ├── run_learner.py         # manual learning accumulation
│   └── lint_wiki.py           # wiki health check
│
└── tests/
    ├── eval_set.jsonl          # hand-built Q&A evaluation set
    ├── test_retrieval.py
    └── test_generation.py
```

***

## AGENTS.md (pi-dev Schema File)

This file is the key configuration for the coding agent. It tells the agent how the wiki is structured and what workflows to follow:

```markdown
# OpenBrain Agent Schema

## Project Intent
This is a local personal AI second brain. All LLM calls use Ollama (local).
No API keys for external LLM providers. Supabase (pgvector) is the store.

## Vault
- Location: configured in .env as VAULT_PATH
- Format: Obsidian markdown with [[wikilinks]] and YAML frontmatter
- Read-only: never write to vault files

## Wiki Layer
- Location: ./wiki/
- Written by: LLM only (via wiki_updater.py)
- Read by: human + LLM query engine
- index.md: catalog; update on every ingest
- log.md: append-only; format: `## [YYYY-MM-DD] <type> | <title>`

## Database (Supabase pgvector)
- note_chunks: source-of-truth for vault content + embeddings
- graph_edges: heuristic knowledge graph (wikilinks + prose extraction)
- wiki_pages: LLM-synthesized entity and concept pages
- learnings: accumulated cross-session insights
- mcp_sessions: full query/answer history

## Ingest Workflow
1. Parse markdown → resolve wikilinks → extract frontmatter
2. Chunk by heading (≤240 tokens, ≤3000 chars hard cap)
3. Embed with Ollama (mxbai-embed-large)
4. Extract entities/relations via local LLM
5. Upsert to Supabase (hash-based change detection)
6. Update wiki pages for affected entities
7. Append to wiki/log.md

## Query Workflow
1. Embed user query (same model as ingest)
2. Semantic search: top-6 chunks, cosine ≥ 0.25
3. Graph expand: 1-hop neighbors from retrieved notes
4. Wiki lookup: read relevant entity/concept pages
5. Assemble context with provenance headers
6. Generate with grounded prompt (Ollama)
7. Optionally file answer as wiki/syntheses/<slug>.md
8. Log to mcp_sessions

## MCP Tools
search_vault, query_graph, get_wiki_page, list_learnings,
ingest_note, file_answer_to_wiki

## Models (all local via Ollama)
- Embedding: mxbai-embed-large (1024 dims)
- Generation: qwen2.5:14b (primary) or llama3.2 (fast)
- Extraction: qwen2.5:14b (entity/relation NER)

## Conventions
- All paths relative to VAULT_PATH
- Entity names normalized to Title Case
- Wikilink edges: confidence = 1.0
- Prose-extracted edges: confidence = model-reported or 0.85 default
- Never auto-apply prose edges to live graph without confidence ≥ 0.7
```

***

## Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Local LLM runtime | Ollama | OpenAI-compatible API, NPU/GPU acceleration, model library |
| Generation model | `qwen2.5:14b` | Best grounding compliance, 128K context |
| Embedding model | `mxbai-embed-large` | 7–18pp retrieval improvement over alternatives |
| Vector database | Supabase pgvector | Managed Postgres + vector, HNSW index, RLS, local Docker option |
| Graph storage | Supabase (graph_edges table) | No separate graph DB needed at this scale |
| Wiki layer | Markdown files (./wiki/) | Human-readable, git-versioned, Obsidian-compatible |
| API framework | FastAPI (Python) | Async, OpenAI-compatible endpoint format |
| MCP server | FastMCP / mcp-python | Enables Claude Desktop, Cursor, OpenCode |
| File watcher | watchdog (Python) | Cross-platform vault change detection |
| Markdown parser | `markdown-it-py` + custom wikilink resolver | Handles Obsidian syntax |

***

## Initial Skills (Implementation Phases)

### Skill 1 — Vault Ingest (MVP)
**Goal:** Parse all 2,000+ notes, chunk, embed, store in Supabase.

- [ ] `parser.py`: wikilink resolver, frontmatter extractor
- [ ] `chunker.py`: heading-based chunking + safety cap
- [ ] `embedder.py`: Ollama `mxbai-embed-large` batch calls
- [ ] `db.py` + `chunks.py`: Supabase upsert with hash-based change detection
- [ ] `scripts/ingest_vault.py`: bulk ingest CLI with progress bar
- [ ] SQL migrations: `note_chunks` table + HNSW index

**Acceptance test:** `openbrain ingest --vault ~/notes` completes on all 2,000 notes; cosine search returns semantically correct chunks.

### Skill 2 — Semantic Chat
**Goal:** Ask a question, get a grounded answer with source citations.

- [ ] `retriever.py`: embed query → pgvector cosine search
- [ ] `assembler.py`: assemble context with provenance headers
- [ ] `generator.py`: Ollama call with grounding prompt
- [ ] `api/main.py`: FastAPI `/chat` endpoint
- [ ] CLI: `openbrain chat "What's the relationship between my masters and my blog?"`

**Acceptance test:** Answer cites actual note titles; "I don't know based on the documents" when context is absent.

### Skill 3 — Heuristic Graph
**Goal:** Build and traverse the knowledge graph.

- [ ] SQL migrations: `graph_edges` table
- [ ] `ingest/extractor.py`: LLM entity/relation extraction with structured output
- [ ] Wikilink edge extraction (deterministic, confidence = 1.0)
- [ ] `store/graph.py`: upsert edges, multi-hop traversal query
- [ ] Query engine update: expand retrieval via 1-hop graph neighbors

**Acceptance test:** "Walk me through dependencies from Kim's mentoring session" uses graph edges to surface connected projects and actions.

### Skill 4 — Wiki Layer
**Goal:** LLM maintains a persistent, growing synthesis wiki.

- [ ] `ingest/wiki_updater.py`: update entity pages post-ingest
- [ ] `wiki/index.md` auto-generation
- [ ] `wiki/log.md` append workflow
- [ ] `/chat` endpoint: option to file answer as new wiki page
- [ ] `scripts/lint_wiki.py`: orphan detection, stale claims, missing pages

**Acceptance test:** After ingesting 10 notes about "Mentoring with Kim", `wiki/entities/kim.md` contains a synthesized profile with cross-references.

### Skill 5 — Accumulated Learnings
**Goal:** System generates insights it discovered across sessions.

- [ ] SQL migrations: `learnings` and `mcp_sessions` tables
- [ ] `learner/accumulator.py`: post-session LLM reflection job
- [ ] `learner/linter.py`: weekly wiki health check
- [ ] API endpoint: `GET /learnings` — latest accumulated insights
- [ ] CLI: `openbrain learn` — run manually or on schedule

**Acceptance test:** After 20 Q&A sessions, `learnings` table contains non-trivial cross-domain insights (e.g., connection between blog writing patterns and academic thesis structure).

### Skill 6 — MCP Server
**Goal:** Expose OpenBrain via MCP for client migration.

- [ ] `mcp/server.py`: implement all 6 tools
- [ ] Bearer token authentication
- [ ] Test with Claude Desktop config
- [ ] Document migration path for new LLM providers

**Acceptance test:** Claude Desktop (or Cursor) can call `search_vault`, `query_graph`, and `get_wiki_page` and get correct results.

***

## Environment Configuration

```env
# .env
VAULT_PATH=/Users/victor/notes

# Supabase (local Docker or managed)
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_KEY=<your-service-key>

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434
EMBED_MODEL=mxbai-embed-large
GEN_MODEL=qwen2.5:14b
EXTRACT_MODEL=qwen2.5:14b

# Retrieval defaults
RETRIEVAL_TOP_K=6
RETRIEVAL_MIN_SIMILARITY=0.25
CHUNK_MAX_TOKENS=240
CHUNK_MAX_CHARS=3000

# Wiki
WIKI_PATH=./wiki
MCP_PORT=27125
MCP_BEARER_TOKEN=<generate-random-token>
```

***

## Docker Compose (Local Infrastructure)

```yaml
# docker-compose.yml
version: "3.9"
services:
  supabase-db:
    image: supabase/postgres:15.1.0.147
    environment:
      POSTGRES_PASSWORD: your-super-secret-password
    ports:
      - "5432:5432"
    volumes:
      - supabase_data:/var/lib/postgresql/data

  supabase-studio:
    image: supabase/studio:latest
    ports:
      - "3000:3000"
    environment:
      SUPABASE_URL: http://supabase-db:5432

  openbrain-api:
    build: .
    ports:
      - "8000:8000"
      - "27125:27125"   # MCP server
    env_file: .env
    volumes:
      - ${VAULT_PATH}:/vault:ro   # read-only vault mount
      - ./wiki:/app/wiki
    depends_on:
      - supabase-db

volumes:
  supabase_data:
```

***

## Key Failure Modes and Mitigations

| Failure Mode | Cause | Mitigation |
|---|---|---|
| Navigation/MOC notes not retrieved | Table/list structure has no prose → embedding captures nothing | Augment thin notes with a 1-sentence synthetic description on ingest |
| Vocabulary mismatch | Query uses metaphor; note uses literal term | Graph traversal provides concept-level expansion beyond semantic similarity |
| Embedding context overflow | Dense tables, code blocks exceed token budget | Hard cap at 3,000 chars with auto-split |
| Stale knowledge | Notes updated but embeddings not refreshed | SHA-256 hash comparison triggers re-ingest on change |
| Hallucinated answers | LLM fills gaps with training data | Strict grounding prompt: "Answer using ONLY the provided context" |
| Entity duplication in graph | Same person named differently across notes | Entity resolution pass: canonical name + deterministic ID |

***

## Relationship to Existing Ecosystem

| Project | What It Contributes | OpenBrain Difference |
|---|---|---|
| Karpathy LLM Wiki | Core wiki-maintenance pattern; ingest/query/lint operations | OpenBrain adds persistent DB, graph layer, and MCP |
| OpenKnowledge (inkeep) | Beautiful markdown editor + MCP + Claude/Codex integration | Cloud-optional; OpenBrain is 100% local |
| obsidian-graph | Semantic graph over Obsidian vault using pgvector | OpenBrain adds wiki synthesis, learnings, and LLM extraction |
| vask / local RAG | Proven local Obsidian RAG pipeline with evaluation data | OpenBrain adopts its embedding/chunking choices and extends |
| OB1 / dschwartzer/open-brain | Personal AI brain prototypes | OpenBrain formalizes into production-grade architecture |
| Supabase pgvector | Vector storage + HNSW index + RLS | Used as the unified storage backend |
| MCP | Protocol for tool-calling across LLM clients | Used as the extensibility/migration layer |

***

## Implementation Checklist for pi-dev

```
Phase 1 (Foundation)
  □ Create project scaffold from structure above
  □ Write SQL migrations (Supabase)
  □ Implement parser.py with wikilink resolver
  □ Implement chunker.py with heading-based strategy
  □ Implement embedder.py with Ollama mxbai-embed-large
  □ Implement bulk ingest CLI
  □ Validate: semantic search returns correct chunks

Phase 2 (Chat)
  □ Implement retriever.py (semantic + wiki)
  □ Implement assembler.py with provenance headers
  □ Implement generator.py with grounding prompt
  □ Launch FastAPI /chat endpoint
  □ Validate: grounded answers with note citations

Phase 3 (Graph)
  □ Implement extractor.py (LLM entity/relation NER)
  □ Implement wikilink edge extraction
  □ Implement graph traversal queries
  □ Integrate graph expansion into retriever
  □ Validate: dependency/action questions use graph

Phase 4 (Wiki + Learnings)
  □ Implement wiki_updater.py
  □ Implement accumulator.py (post-session insights)
  □ Implement linter.py (wiki health)
  □ Validate: wiki pages grow after ingestion

Phase 5 (MCP)
  □ Implement mcp/server.py with all 6 tools
  □ Test with Claude Desktop config
  □ Document provider migration guide
```

---

## References

1. [GitHub - drewburchfield/obsidian-graph: Semantic knowledge graph ...](https://github.com/drewburchfield/obsidian-graph) - Semantic knowledge graph navigation for Obsidian or markdown vaults using AI-powered vector embeddin...

2. [How I build a local RAG pipeline over my Obsidian vault](https://www.productivity.dev/local-rag-obsidian-vault/) - I built a local RAG pipeline over 770 Obsidian notes. Everything runs on my machine, nothing hits th...

3. [pgvector: Embeddings and vector similarity | Supabase Docs](https://supabase.com/docs/guides/database/extensions/pgvector) - pgvector: a Postgres extension for storing embeddings and performing vector similarity search.

4. [Embeddings and Vector Databases for Fast RAG (100% Local) | Ollama, Supabase (PostgreSQL + pgvector)](https://www.youtube.com/watch?v=zdw8Wq0nHbk) - Complete tutorial and source code (requires MLExpert Pro): https://www.mlexpert.io/academy/v2/contex...

5. [[PDF] A Survey on Model Context Protocol](https://d197for5662m48.cloudfront.net/documents/publicationstatus/254518/preprint_pdf/df53cd226b4b6d22e8ca4ff30677752e.pdf)

6. [Markdown to Knowledge Graph: 2026 Toolkit](https://knodegraph.com/blog/markdown-to-knowledge-graph) - Obsidian's graph view only shows page links. Here's how to extract typed entities and relationships ...

7. [Large Language Models - Obsidian Plugin](https://community.obsidian.md/plugins/large-language-models) - Enables access to LLMs via remote providers (OpenAI, Claude, Gemini) and local LLMs via GPT4ALL.

8. [Architecture - Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/architecture)

9. [Supabase pgvector Guide — Semantic Search, RAG, and ...](https://dev.to/kanta13jp1/supabase-pgvector-guide-semantic-search-rag-and-recommendations-in-postgresql-2dpc) - pgvector adds vector types to PostgreSQL. Supabase enables it by default — meaning you can build sem...

10. [Production RAG That Actually Works: Supabase pgvector with Bounded Corpus and Auto-Refresh](https://www.youtube.com/watch?v=xQa7nrICU3o) - Production RAG That Actually Works: Supabase pgvector with Bounded Corpus and Auto-Refresh

  The Pr...

