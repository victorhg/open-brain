-- Graph Edges — Thought-Centric Knowledge Graph
-- Adds a graph_edges table that connects thoughts to other thoughts, enabling
-- 1-hop retrieval expansion beyond pure semantic similarity.
-- Safe to run multiple times (fully idempotent).

-- ============================================================
-- 1. TABLE
-- ============================================================
--
-- Design note: edges are thought-to-thought, not entity-to-entity. The
-- retrieval use case is "I found thought A semantically — what other
-- thoughts are strongly connected to it?" Entity names (wikilink text,
-- shared tag) are metadata on the edge, not separate graph nodes. This
-- keeps traversal to a single indexed lookup instead of an entity
-- resolution step.

CREATE TABLE IF NOT EXISTS graph_edges (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_thought_id  UUID NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  target_thought_id  UUID NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  edge_source        TEXT NOT NULL CHECK (edge_source IN ('wikilink', 'tag_comention')),
  confidence         NUMERIC(4,3) NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- metadata shape by edge_source:
  --   wikilink:       { "link_text": "Original Title" }
  --   tag_comention:  { "tag": "#mestrado/capstone", "tag_frequency": 42 }
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One edge per (source, target, source-type) pair — re-running an
  -- extractor updates confidence/metadata via ON CONFLICT rather than
  -- duplicating rows.
  UNIQUE (source_thought_id, target_thought_id, edge_source)
);

-- No self-loops
ALTER TABLE graph_edges DROP CONSTRAINT IF EXISTS graph_edges_no_self_loop;
ALTER TABLE graph_edges ADD CONSTRAINT graph_edges_no_self_loop
  CHECK (source_thought_id <> target_thought_id);

-- ============================================================
-- 2. INDEXES
-- ============================================================
-- Traversal is always "give me neighbors of thought X" — needed in both
-- directions since wikilinks are directional but retrieval expansion
-- should follow edges either way.

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges (source_thought_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges (target_thought_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_confidence ON graph_edges (confidence DESC);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source_type ON graph_edges (edge_source);

-- ============================================================
-- 3. ROW-LEVEL SECURITY
-- ============================================================
-- Match the thoughts table's posture: service_role only. No anon access.

ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "graph_edges_service_role_all" ON graph_edges;
CREATE POLICY "graph_edges_service_role_all" ON graph_edges
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 4. RPC — 1-hop neighbor expansion (chunk-aware)
-- ============================================================
-- Given a set of thought IDs (e.g. top semantic search hits), return their
-- graph neighbors above a confidence threshold.
--
-- Chunk-awareness: Obsidian notes are chunked by heading into multiple
-- `thoughts` rows sharing the same metadata.title. Edges are stored between
-- *canonical* thought IDs (one per note, see bin/extract-wikilink-edges.js).
-- A semantic-search hit can be ANY chunk of a note, not necessarily the
-- canonical one, so this RPC:
--   1. Maps each seed thought to its note's canonical ID (MIN(id) among
--      thoughts sharing the same metadata.title) before querying edges.
--   2. Maps each neighbor's canonical ID back to the most *substantive*
--      chunk of that note (longest content) before returning it, so callers
--      get real content instead of a possibly tiny section fragment.

CREATE OR REPLACE FUNCTION expand_graph_neighbors(
  p_thought_ids UUID[],
  p_min_confidence NUMERIC DEFAULT 0.5,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  neighbor_id     UUID,
  content         TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ,
  via_thought_id  UUID,
  edge_source     TEXT,
  confidence      NUMERIC
)
LANGUAGE sql
STABLE
SET statement_timeout = '10s'
AS $$
  WITH seeds AS (
    SELECT id, metadata->>'title' AS title
    FROM thoughts
    WHERE id = ANY(p_thought_ids)
  ),
  seed_canonical AS (
    -- canonical id per seed's note = MIN(id) among all chunks sharing that title
    -- (cast to text: postgres has no MIN/MAX aggregate for uuid; text comparison
    -- gives a consistent deterministic order, matching the JS extractor's
    -- string comparison in bin/extract-wikilink-edges.js)
    SELECT s.title, MIN(t.id::text)::uuid AS canonical_id
    FROM seeds s
    JOIN thoughts t ON t.metadata->>'title' = s.title
    WHERE s.title IS NOT NULL
    GROUP BY s.title
  ),
  seed_ids AS (
    -- union of literal seed ids (covers thoughts with no title) + canonical ids
    SELECT id FROM seeds
    UNION
    SELECT canonical_id FROM seed_canonical
  ),
  raw_edges AS (
    SELECT
      target_thought_id AS neighbor_canonical,
      source_thought_id AS via_thought_id,
      edge_source,
      confidence
    FROM graph_edges
    WHERE source_thought_id IN (SELECT id FROM seed_ids)
      AND confidence >= p_min_confidence

    UNION ALL

    SELECT
      source_thought_id AS neighbor_canonical,
      target_thought_id AS via_thought_id,
      edge_source,
      confidence
    FROM graph_edges
    WHERE target_thought_id IN (SELECT id FROM seed_ids)
      AND confidence >= p_min_confidence
  ),
  neighbor_titles AS (
    SELECT re.*, t.metadata->>'title' AS title
    FROM raw_edges re
    JOIN thoughts t ON t.id = re.neighbor_canonical
  ),
  neighbor_best_chunk AS (
    -- pick the most substantive chunk (longest content) per neighbor note
    SELECT DISTINCT ON (nt.title)
      nt.title, nt.via_thought_id, nt.edge_source, nt.confidence,
      t2.id AS rep_id, t2.content, t2.metadata, t2.created_at
    FROM neighbor_titles nt
    JOIN thoughts t2 ON t2.metadata->>'title' = nt.title
    ORDER BY nt.title, length(t2.content) DESC
  )
  SELECT DISTINCT ON (rep_id)
    rep_id AS neighbor_id, content, metadata, created_at, via_thought_id, edge_source, confidence
  FROM neighbor_best_chunk nbc
  WHERE rep_id <> ALL(p_thought_ids) -- don't return the literal seed thoughts themselves
    AND NOT EXISTS (
      -- don't return a different CHUNK of the same note as one of the seeds
      -- (a seed's title can match a neighbor's title even if the specific
      -- chunk ids differ, since notes are split into multiple thoughts rows)
      SELECT 1 FROM seeds s WHERE s.title IS NOT NULL AND s.title = nbc.title
    )
  ORDER BY rep_id, confidence DESC
  LIMIT p_limit;
$$;

-- Not granted to anon — service_role and authenticated only, matching the
-- rest of the schema's private-by-default posture.
REVOKE ALL ON FUNCTION expand_graph_neighbors(UUID[], NUMERIC, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expand_graph_neighbors(UUID[], NUMERIC, INTEGER) TO authenticated, service_role;

-- ============================================================
-- 5. INDEX — title lookup (canonical-id + best-chunk resolution)
-- ============================================================
-- expand_graph_neighbors joins on metadata->>'title' twice per call
-- (canonical resolution + best-chunk resolution). Expression index keeps
-- both fast even as the corpus grows.

CREATE INDEX IF NOT EXISTS idx_thoughts_title_expr ON thoughts ((metadata->>'title'));
