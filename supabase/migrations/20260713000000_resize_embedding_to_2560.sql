-- ============================================================
-- Migration: Resize thoughts.embedding from vector(1536) to vector(2560)
--
-- Reason: The local embedding model (Qwen3-Embedding-4B-4bit-DWQ)
-- produces 2560-dimensional vectors. All embeddings must be
-- regenerated after applying this migration.
--
-- Note on HNSW limits: pgvector's HNSW index only supports up to
-- 2000 dimensions for the `vector` type. For 2560 dims we index a
-- halfvec cast instead (supported up to 4000 dims), which keeps
-- full-precision storage while still enabling fast ANN search.
--
-- Steps:
--   1. Drop the old HNSW index (required before altering column type)
--   2. Truncate the table — all 1536-dim embeddings are stale and
--      must be regenerated with the local model at 2560 dims.
--   3. Alter the column type to vector(2560)
--   4. Recreate the HNSW index via a halfvec cast (cosine similarity)
-- ============================================================

-- Step 1: Drop the existing HNSW index
DROP INDEX IF EXISTS public.thoughts_embedding_idx;

-- Step 2: Truncate stale data (CASCADE to clear FK-dependent audit table)
TRUNCATE public.thoughts CASCADE;

-- Step 3: Resize the column
ALTER TABLE public.thoughts
  ALTER COLUMN embedding TYPE vector(2560);

-- Step 4: Recreate HNSW index using halfvec cast (bypasses 2000-dim limit)
CREATE INDEX thoughts_embedding_idx
  ON public.thoughts
  USING hnsw ((embedding::halfvec(2560)) halfvec_cosine_ops);
