-- Wiki Pages — Pre-computed synthesis layer
-- One row per topic hub: a 250-350 word synthesis of a well-connected note
-- and its graph neighbors, embedded for semantic retrieval.
-- Safe to run multiple times (fully idempotent).

-- ============================================================
-- 1. TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS wiki_pages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- slug is the stable upsert key: url-safe, derived from the hub note title.
  -- Rebuilding a page updates the existing row rather than inserting a duplicate.
  slug                TEXT UNIQUE NOT NULL,

  title               TEXT NOT NULL,

  -- The synthesized text (~250-350 words) produced by the local chat LLM.
  content             TEXT NOT NULL,

  -- Free-text page type. Current values: 'hub_synthesis'.
  -- Expand when new synthesis paths are added; no enum constraint by design.
  page_type           TEXT NOT NULL DEFAULT 'hub_synthesis',

  -- Canonical thought IDs of the hub + neighbors used to build this page.
  -- Used to detect staleness (a source thought was updated) and for provenance.
  source_thought_ids  UUID[] NOT NULL DEFAULT '{}',

  -- Embedding of the synthesized content — same model & dimensions as thoughts.
  -- NULL until the embedding step completes; status column tracks progress.
  embedding           VECTOR(2560),

  -- Which local chat model produced the synthesis (e.g. gemma-4-26B-A4B-it-MLX-6bit).
  -- If the model changes, old pages should be rebuilt.
  model_used          TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep updated_at current on every upsert
CREATE OR REPLACE FUNCTION wiki_pages_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wiki_pages_updated_at ON wiki_pages;
CREATE TRIGGER wiki_pages_updated_at
  BEFORE UPDATE ON wiki_pages
  FOR EACH ROW EXECUTE FUNCTION wiki_pages_set_updated_at();

-- ============================================================
-- 2. INDEXES
-- ============================================================

-- No vector index: wiki_pages will hold at most a few hundred rows,
-- so an exact sequential scan via the <=> operator is fast enough.
-- (pgvector HNSW and IVFFlat are both capped at 2000 dims on this
-- Supabase version; our embedding is 2560 dims.)
-- Add an approximate index here if the table grows beyond ~10k rows.

-- GIN for full-text title search (catches exact name mentions that embeddings miss).
CREATE INDEX IF NOT EXISTS idx_wiki_pages_title_fts
  ON wiki_pages USING gin (to_tsvector('simple', coalesce(title, '')));

-- ============================================================
-- 3. ROW-LEVEL SECURITY
-- ============================================================

ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wiki_pages_service_role_all" ON wiki_pages;
CREATE POLICY "wiki_pages_service_role_all" ON wiki_pages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 4. RPC — semantic search over wiki pages
-- ============================================================
-- Mirrors the match_thoughts RPC pattern. Used by lib/context-assembler.js
-- Stage 3 (--wiki flag) and by the open-brain-mcp edge function.

CREATE OR REPLACE FUNCTION match_wiki_pages(
  query_embedding VECTOR(2560),
  match_threshold FLOAT DEFAULT 0.3,
  match_count     INT   DEFAULT 3
)
RETURNS TABLE (
  id                 UUID,
  slug               TEXT,
  title              TEXT,
  content            TEXT,
  page_type          TEXT,
  source_thought_ids UUID[],
  model_used         TEXT,
  updated_at         TIMESTAMPTZ,
  similarity         FLOAT
)
LANGUAGE sql
STABLE
SET statement_timeout = '10s'
AS $$
  SELECT
    id, slug, title, content, page_type,
    source_thought_ids, model_used, updated_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM wiki_pages
  WHERE embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) >= match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION match_wiki_pages(VECTOR, FLOAT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_wiki_pages(VECTOR, FLOAT, INT)
  TO authenticated, service_role;
