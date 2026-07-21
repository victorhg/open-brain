# Graph Edges — Thought-Centric Knowledge Graph

Adds a `graph_edges` table that connects thoughts to other thoughts, powering
1-hop retrieval expansion beyond pure semantic similarity.

## What It Does

Two deterministic (no-LLM) edge sources populate the graph:

- **Wikilinks** — Obsidian `[[Note Title]]` links, already extracted into
  `metadata.wikilinks` at ingest time. Resolved to thought UUIDs by title match.
  Confidence `1.0`.
- **Tag co-mentions** — thoughts that share a specific (non-generic) tag are
  connected. Confidence scaled by tag rarity (rarer tags = stronger signal).

Coverage on a typical vault: wikilinks alone cover ~90% of thoughts; adding
tag co-mentions brings that closer to ~95%. No LLM calls, no entity
extraction — this schema deliberately trades some semantic nuance for
speed, determinism, and zero ongoing inference cost.

## Design: thought-centric, not entity-centric

Edges connect `source_thought_id → target_thought_id` directly. Entity names
(the wikilink text, the shared tag) live in the `metadata` JSONB column on
the edge — they are not separate graph nodes. This means traversal is a
single indexed lookup (`WHERE source_thought_id = ANY(...)`) instead of an
entity-resolution join. If you later want a full entity-relation graph
(LLM-extracted `works_at`, `authored_by`, etc.), that's a separate schema
layered on top — this one is intentionally the deterministic foundation.

## Installation

1. Open your Supabase project → **SQL Editor**
2. Paste the contents of `schema.sql`
3. Click **Run**
4. Confirm the `graph_edges` table appears in **Table Editor**
5. Confirm `expand_graph_neighbors` appears in **Database > Functions**

Alternatively, via the Supabase CLI (requires `SUPABASE_DB_PASSWORD` set and
the project linked):

```bash
supabase link --project-ref <your-ref>
export SUPABASE_DB_PASSWORD='<your-db-password>'
supabase db push
```

## After deploying: populate the graph

```bash
node bin/extract-wikilink-edges.js       # ~2 min for ~4,000 thoughts
node bin/extract-tag-comention-edges.js  # ~1 min
```

Both scripts are idempotent (`ON CONFLICT DO UPDATE`) — safe to re-run after
new thoughts are ingested.

## Schema

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `source_thought_id` | `uuid` | FK → `thoughts.id`, cascade delete |
| `target_thought_id` | `uuid` | FK → `thoughts.id`, cascade delete |
| `edge_source` | `text` | `'wikilink'` \| `'tag_comention'` |
| `confidence` | `numeric(4,3)` | `1.0` for wikilinks; scaled by rarity for tags |
| `metadata` | `jsonb` | `{link_text}` or `{tag, tag_frequency}` |
| `created_at` | `timestamptz` | |

Unique on `(source_thought_id, target_thought_id, edge_source)` — re-running
an extractor updates the existing edge rather than duplicating it.

## RPC: `expand_graph_neighbors`

```sql
expand_graph_neighbors(
  p_thought_ids   uuid[],           -- seed thoughts (e.g. top semantic hits)
  p_min_confidence numeric DEFAULT 0.5,
  p_limit         integer DEFAULT 20
)
```

Returns 1-hop neighbors in **either direction** (a thought that links to your
seed, or one your seed links to), joined with thought content, excluding the
seed thoughts themselves. Used by `lib/context-assembler.js` when
`includeGraph: true`.

## Security

- RLS enabled, `service_role`-only policy — matches the `thoughts` table's
  private-by-default posture.
- `expand_graph_neighbors` is granted to `authenticated` and `service_role`
  only. Not exposed to `anon`.

## Troubleshooting

**Issue: low wikilink resolution rate**
Some `[[links]]` point to notes that don't exist as thoughts yet (unlinked
mentions), or Obsidian aliases (`[[Real Title|Alias]]`) that weren't
normalized at ingest. Check `bin/extract-wikilink-edges.js` output for the
unresolved-link list.

**Issue: too many edges from one tag**
`bin/extract-tag-comention-edges.js` filters tags by frequency band
(default 5–50 occurrences) specifically to avoid this — very common tags
(`#resource`, `#note`) create a near-complete graph with no signal. Adjust
`MIN_TAG_FREQ` / `MAX_TAG_FREQ` at the top of the script if your vault's
tag distribution differs.
