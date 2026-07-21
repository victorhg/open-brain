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
-- 4. RPC — 1-hop neighbor expansion
-- ============================================================
-- Given a set of thought IDs (e.g. top semantic search hits), return their
-- graph neighbors (both directions) above a confidence threshold, joined
-- with thought content for direct use in context assembly.

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
  SELECT DISTINCT ON (neighbor_id)
    neighbor_id,
    t.content,
    t.metadata,
    t.created_at,
    via_thought_id,
    edge_source,
    confidence
  FROM (
    SELECT
      target_thought_id AS neighbor_id,
      source_thought_id AS via_thought_id,
      edge_source,
      confidence
    FROM graph_edges
    WHERE source_thought_id = ANY(p_thought_ids)
      AND confidence >= p_min_confidence

    UNION ALL

    SELECT
      source_thought_id AS neighbor_id,
      target_thought_id AS via_thought_id,
      edge_source,
      confidence
    FROM graph_edges
    WHERE target_thought_id = ANY(p_thought_ids)
      AND confidence >= p_min_confidence
  ) edges
  JOIN thoughts t ON t.id = edges.neighbor_id
  WHERE edges.neighbor_id <> ALL(p_thought_ids) -- don't return the seed thoughts themselves
  ORDER BY neighbor_id, confidence DESC
  LIMIT p_limit;
$$;

-- Not granted to anon — service_role and authenticated only, matching the
-- rest of the schema's private-by-default posture.
REVOKE ALL ON FUNCTION expand_graph_neighbors(UUID[], NUMERIC, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expand_graph_neighbors(UUID[], NUMERIC, INTEGER) TO authenticated, service_role;
