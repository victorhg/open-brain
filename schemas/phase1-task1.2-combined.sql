-- ============================================================================
-- OPEN BRAIN (OB1) - PHASE 1, TASK 1.2: COMBINED ENHANCED SCHEMAS
-- Deploys: 
--   1. smart-ingest (Fingerprint Deduplication Pipeline)
--   2. text-search-trgm (Trigram Search Index for 50x query acceleration)
--   3. enhanced-thoughts (Richer classification columns + utility RPCs)
--   4. workflow-status (Task/idea status tracking & backfill)
--   5. provenance-chains (Thought lineage, citation and tree-walking helpers)
--
-- Safe to execute multiple times (fully idempotent).
-- ============================================================================

-- ============================================================================
-- SCHEMA 1: smart-ingest
-- Pipeline tables for tracking extract, deduplicate, and execute lifecycles.
-- ============================================================================

-- 1. INGESTION JOBS
CREATE TABLE IF NOT EXISTS public.ingestion_jobs (
  id bigserial PRIMARY KEY,
  source_label text,
  input_hash text NOT NULL UNIQUE,
  input_length int,
  status text DEFAULT 'pending',        -- pending, extracting, dry_run_complete, executing, complete, failed
  extracted_count int DEFAULT 0,
  added_count int DEFAULT 0,
  skipped_count int DEFAULT 0,
  appended_count int DEFAULT 0,
  revised_count int DEFAULT 0,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- 2. INGESTION ITEMS
CREATE TABLE IF NOT EXISTS public.ingestion_items (
  id bigserial PRIMARY KEY,
  job_id bigint REFERENCES public.ingestion_jobs(id) ON DELETE CASCADE,
  extracted_content text NOT NULL,
  action text NOT NULL DEFAULT 'pending',   -- pending, add, skip, append_evidence, create_revision
  status text NOT NULL DEFAULT 'pending',   -- pending, ready, executed, failed
  reason text,
  matched_thought_id bigint,
  similarity_score numeric(5,4),
  result_thought_id bigint,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Index for fast job-item lookups
CREATE INDEX IF NOT EXISTS ingestion_items_job_idx
  ON public.ingestion_items(job_id);

-- Partial indexes for queue optimization
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_pending
  ON public.ingestion_jobs (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ingestion_items_pending
  ON public.ingestion_items (job_id, created_at)
  WHERE status IN ('pending', 'ready');

-- Multi-tenant user scoping support
ALTER TABLE public.ingestion_jobs ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.ingestion_items ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'auth'
  ) AND EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth' AND c.relname = 'users'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_jobs_user_id_fkey'
    ) THEN
      ALTER TABLE public.ingestion_jobs
        ADD CONSTRAINT ingestion_jobs_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_items_user_id_fkey'
    ) THEN
      ALTER TABLE public.ingestion_items
        ADD CONSTRAINT ingestion_items_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  END IF;
END
$$;

-- 3. APPEND EVIDENCE RPC
CREATE OR REPLACE FUNCTION public.append_thought_evidence(
  p_thought_id bigint,
  p_evidence jsonb  -- {source, extracted_at, excerpt, source_label}
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity text;
  v_current_evidence jsonb;
  v_entry jsonb;
  v_count int;
BEGIN
  -- Compute a stable identity for this evidence entry
  v_identity := encode(
    sha256(
      convert_to(
        coalesce(p_evidence->>'source_label', '') ||
        coalesce(p_evidence->>'excerpt', '') ||
        p_thought_id::text,
        'UTF8'
      )
    ),
    'hex'
  );

  -- Fetch current evidence array
  SELECT coalesce(metadata->'evidence', '[]'::jsonb)
    INTO v_current_evidence
    FROM public.thoughts
   WHERE id = p_thought_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'thought % not found', p_thought_id;
  END IF;

  -- Check for duplicate by scanning existing identities
  FOR v_entry IN SELECT jsonb_array_elements(v_current_evidence)
  LOOP
    IF v_entry->>'_identity' = v_identity THEN
      RETURN jsonb_build_object(
        'thought_id', p_thought_id,
        'evidence_count', jsonb_array_length(v_current_evidence),
        'action', 'already_exists'
      );
    END IF;
  END LOOP;

  -- Append new evidence entry with identity tag
  UPDATE public.thoughts
     SET metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{evidence}',
           v_current_evidence || jsonb_build_object(
             '_identity', v_identity,
             'source', p_evidence->'source',
             'extracted_at', p_evidence->'extracted_at',
             'excerpt', p_evidence->'excerpt',
             'source_label', p_evidence->'source_label'
           )
         )
   WHERE id = p_thought_id;

  v_count := jsonb_array_length(v_current_evidence) + 1;

  RETURN jsonb_build_object(
    'thought_id', p_thought_id,
    'evidence_count', v_count,
    'action', 'appended'
  );
END;
$$;

-- 4. GRANTS (smart-ingest)
GRANT ALL ON TABLE public.ingestion_jobs TO service_role;
GRANT ALL ON TABLE public.ingestion_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ingestion_jobs_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ingestion_items_id_seq TO service_role;
REVOKE EXECUTE ON FUNCTION public.append_thought_evidence(bigint, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.append_thought_evidence(bigint, jsonb) TO service_role;

-- 5. RLS (smart-ingest)
ALTER TABLE public.ingestion_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingestion_jobs_service_all  ON public.ingestion_jobs;
DROP POLICY IF EXISTS ingestion_jobs_user_select  ON public.ingestion_jobs;
DROP POLICY IF EXISTS ingestion_items_service_all ON public.ingestion_items;
DROP POLICY IF EXISTS ingestion_items_user_select ON public.ingestion_items;

CREATE POLICY ingestion_jobs_service_all ON public.ingestion_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ingestion_items_service_all ON public.ingestion_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY ingestion_jobs_user_select ON public.ingestion_jobs FOR SELECT TO authenticated USING (user_id IS NOT NULL AND user_id = auth.uid())
    $policy$;
    EXECUTE $policy$
      CREATE POLICY ingestion_items_user_select ON public.ingestion_items FOR SELECT TO authenticated USING (user_id IS NOT NULL AND user_id = auth.uid())
    $policy$;
  END IF;
END
$$;


-- ============================================================================
-- SCHEMA 2: text-search-trgm
-- Installs pg_trgm extension and content trigram index to accelerate ILIKE text search fallback.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_thoughts_content_trgm
  ON public.thoughts
  USING gin (content gin_trgm_ops);

COMMENT ON INDEX public.idx_thoughts_content_trgm IS
  'Trigram GIN index on content for ILIKE ''%foo%'' patterns. Accelerates search_thoughts_text ILIKE fallback from ~8s to ~150ms on rare-word queries.';


-- ============================================================================
-- SCHEMA 3: enhanced-thoughts
-- Adds structured columns, indices, full-text search, and brain statistics aggregate functions.
-- ============================================================================

-- 1. ADD COLUMNS
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS sensitivity_tier TEXT DEFAULT 'standard';
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS importance SMALLINT DEFAULT 3;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,2) DEFAULT 50;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS enriched BOOLEAN DEFAULT false;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT NULL;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT now();

-- 2. CREATE INDEXES
CREATE INDEX IF NOT EXISTS idx_thoughts_type ON thoughts (type);
CREATE INDEX IF NOT EXISTS idx_thoughts_importance ON thoughts (importance DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_source_type ON thoughts (source_type);
CREATE INDEX IF NOT EXISTS idx_thoughts_status ON thoughts (status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_thoughts_content_tsvector ON thoughts USING gin (to_tsvector('simple', coalesce(content, '')));

-- 3. SEARCH THOUGHTS TEXT RPC
CREATE OR REPLACE FUNCTION search_thoughts_text(
  p_query TEXT,
  p_limit INTEGER DEFAULT 25,
  p_filter JSONB DEFAULT '{}'::jsonb,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  type TEXT,
  source_type TEXT,
  importance SMALLINT,
  quality_score NUMERIC(5,2),
  sensitivity_tier TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  rank REAL,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SET statement_timeout = '25s'
AS $$
BEGIN
  RETURN QUERY
  WITH query_input AS (
    SELECT
      trim(coalesce(p_query, '')) AS raw_query,
      websearch_to_tsquery('simple', trim(coalesce(p_query, ''))) AS ts_query
  ),
  tsvector_hits AS (
    SELECT t.id AS hit_id
    FROM public.thoughts t
    CROSS JOIN query_input q
    WHERE q.raw_query <> ''
      AND to_tsvector('simple', coalesce(t.content, '')) @@ q.ts_query
      AND t.metadata @> coalesce(p_filter, '{}'::jsonb)
    LIMIT 2000
  ),
  ilike_hits AS (
    SELECT t.id AS hit_id
    FROM public.thoughts t
    CROSS JOIN query_input q
    WHERE q.raw_query <> ''
      AND (SELECT count(*) FROM tsvector_hits) < (p_limit + p_offset)
      AND t.content ILIKE '%' || q.raw_query || '%'
      AND t.metadata @> coalesce(p_filter, '{}'::jsonb)
      AND NOT EXISTS (SELECT 1 FROM tsvector_hits th WHERE th.hit_id = t.id)
    LIMIT 500
  ),
  all_hits AS (
    SELECT hit_id FROM tsvector_hits
    UNION
    SELECT hit_id FROM ilike_hits
  ),
  hit_count AS (
    SELECT count(*) AS cnt FROM all_hits
  ),
  ranked AS (
    SELECT
      t.id,
      t.content,
      t.type,
      t.source_type,
      t.importance,
      t.quality_score,
      t.sensitivity_tier,
      t.metadata,
      t.created_at,
      (
        greatest(
          ts_rank_cd(
            to_tsvector('simple', coalesce(t.content, '')),
            q.ts_query
          ),
          CASE
            WHEN q.raw_query <> '' AND t.content ILIKE '%' || q.raw_query || '%'
              THEN 0.35
            ELSE 0
          END
        )
        + (coalesce(t.importance, 3) / 20.0)::real
        + (coalesce(t.quality_score, 50) / 500.0)::real
      )::real AS rank
    FROM public.thoughts t
    CROSS JOIN query_input q
    WHERE t.id IN (SELECT ah.hit_id FROM all_hits ah)
    ORDER BY rank DESC, t.created_at DESC
  )
  SELECT
    r.id, r.content, r.type, r.source_type, r.importance,
    r.quality_score, r.sensitivity_tier, r.metadata, r.created_at,
    r.rank,
    hc.cnt AS total_count
  FROM ranked r
  CROSS JOIN hit_count hc
  OFFSET greatest(0, coalesce(p_offset, 0))
  LIMIT greatest(1, least(coalesce(p_limit, 25), 100));
END;
$$;

GRANT EXECUTE ON FUNCTION search_thoughts_text(TEXT, INTEGER, JSONB, INTEGER) TO authenticated, service_role;

-- 4. BRAIN STATS AGGREGATE RPC
CREATE OR REPLACE FUNCTION brain_stats_aggregate(
  p_since_days INTEGER DEFAULT 30,
  p_exclude_restricted BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_types JSONB;
  v_topics JSONB;
  v_since TIMESTAMPTZ;
BEGIN
  IF p_since_days > 0 THEN
    v_since := now() - (p_since_days || ' days')::interval;
  ELSE
    v_since := '-infinity'::timestamptz;
  END IF;

  SELECT count(*) INTO v_total
  FROM public.thoughts
  WHERE (NOT p_exclude_restricted OR sensitivity_tier IS DISTINCT FROM 'restricted');

  SELECT coalesce(jsonb_agg(jsonb_build_object('type', t.type, 'count', t.cnt)), '[]'::jsonb)
  INTO v_types FROM (
    SELECT type, count(*) AS cnt FROM public.thoughts
    WHERE created_at >= v_since
      AND (NOT p_exclude_restricted OR sensitivity_tier IS DISTINCT FROM 'restricted')
    GROUP BY type ORDER BY cnt DESC LIMIT 20
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object('topic', t.topic, 'count', t.cnt)), '[]'::jsonb)
  INTO v_topics FROM (
    SELECT topic.value AS topic, count(*) AS cnt
    FROM public.thoughts,
         jsonb_array_elements_text(coalesce(metadata->'topics', '[]'::jsonb)) AS topic(value)
    WHERE created_at >= v_since
      AND (NOT p_exclude_restricted OR sensitivity_tier IS DISTINCT FROM 'restricted')
    GROUP BY topic.value ORDER BY cnt DESC LIMIT 20
  ) t;

  RETURN jsonb_build_object('total', v_total, 'top_types', v_types, 'top_topics', v_topics);
END;
$$;

GRANT EXECUTE ON FUNCTION brain_stats_aggregate(INTEGER, BOOLEAN) TO authenticated, service_role;

-- 5. THOUGHT CONNECTIONS RPC
CREATE OR REPLACE FUNCTION get_thought_connections(
  p_thought_id UUID,
  p_limit INT DEFAULT 20,
  p_exclude_restricted BOOLEAN DEFAULT true
)
RETURNS TABLE (
  id UUID,
  type TEXT,
  importance SMALLINT,
  preview TEXT,
  created_at TIMESTAMPTZ,
  shared_topics TEXT[],
  shared_people TEXT[],
  overlap_count INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_topics TEXT[];
  source_people TEXT[];
BEGIN
  SELECT
    coalesce(
      (SELECT array_agg(val) FROM jsonb_array_elements_text(t.metadata->'topics') val),
      '{}'::text[]
    ),
    coalesce(
      (SELECT array_agg(val) FROM jsonb_array_elements_text(t.metadata->'people') val),
      '{}'::text[]
    )
  INTO source_topics, source_people
  FROM thoughts t
  WHERE t.id = p_thought_id;

  IF source_topics = '{}'::text[] AND source_people = '{}'::text[] THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      bt.id,
      bt.type,
      bt.importance,
      left(bt.content, 200) AS preview,
      bt.created_at,
      coalesce(
        (SELECT array_agg(val) FROM jsonb_array_elements_text(bt.metadata->'topics') val
         WHERE val = ANY(source_topics)),
        '{}'::text[]
      ) AS shared_topics,
      coalesce(
        (SELECT array_agg(val) FROM jsonb_array_elements_text(bt.metadata->'people') val
         WHERE val = ANY(source_people)),
        '{}'::text[]
      ) AS shared_people
    FROM thoughts bt
    WHERE bt.id != p_thought_id
      AND (NOT p_exclude_restricted OR bt.sensitivity_tier IS DISTINCT FROM 'restricted')
      AND (
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(bt.metadata->'topics') val
          WHERE val = ANY(source_topics)
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(bt.metadata->'people') val
          WHERE val = ANY(source_people)
        )
      )
  )
  SELECT
    c.id, c.type, c.importance, c.preview, c.created_at,
    c.shared_topics, c.shared_people,
    (coalesce(array_length(c.shared_topics, 1), 0) + coalesce(array_length(c.shared_people, 1), 0))::int AS overlap_count
  FROM candidates c
  ORDER BY overlap_count DESC, c.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_thought_connections(UUID, INT, BOOLEAN) TO authenticated, service_role;

-- 6. TYPE BACKFILL RPC
CREATE OR REPLACE FUNCTION backfill_thought_types(
  p_allowed_types TEXT[] DEFAULT ARRAY[
    'idea','task','person_note','reference',
    'decision','lesson','meeting','journal'
  ]
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_updated BIGINT;
BEGIN
  UPDATE public.thoughts
  SET type = metadata->>'type'
  WHERE type IS NULL
    AND metadata->>'type' IS NOT NULL
    AND (p_allowed_types IS NULL OR metadata->>'type' = ANY(p_allowed_types));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION backfill_thought_types(TEXT[]) TO authenticated, service_role;

-- Auto-run backfill for standard types
SELECT backfill_thought_types();

-- Backfill source types
UPDATE thoughts SET source_type = metadata->>'source'
WHERE source_type IS NULL AND metadata->>'source' IS NOT NULL;


-- ============================================================================
-- SCHEMA 4: workflow-status
-- Enables statuses and tracking for tasks and ideas.
-- ============================================================================

-- Backfill: set existing task and idea thoughts to 'new' status if they don't have one
UPDATE thoughts
SET status = 'new', status_updated_at = now()
WHERE (type IN ('task', 'idea') OR metadata->>'type' IN ('task', 'idea')) AND status IS NULL;


-- ============================================================================
-- ENHANCED UPSERT_THOUGHT RPC (from Schema 3 / enhanced-thoughts)
-- Integrates all updates (fingerprint deduplication, workflow status & metadata columns)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_thought(p_content TEXT, p_payload JSONB DEFAULT '{}')
RETURNS JSONB AS $$
DECLARE
  v_fingerprint TEXT;
  v_result JSONB;
  v_id UUID;
  v_metadata JSONB;
  v_type TEXT;
  v_source_type TEXT;
  v_importance SMALLINT;
  v_quality_score NUMERIC(5,2);
  v_sensitivity_tier TEXT;
  v_status TEXT;
BEGIN
  v_metadata := COALESCE(p_payload->'metadata', '{}'::jsonb);
  v_type := COALESCE(NULLIF(v_metadata->>'type', ''), 'observation');
  v_source_type := COALESCE(NULLIF(v_metadata->>'source_type', ''), NULLIF(v_metadata->>'source', ''), 'unknown');
  v_importance := CASE
    WHEN COALESCE(v_metadata->>'importance', '') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN LEAST(100, GREATEST(0, ROUND((v_metadata->>'importance')::numeric)))::smallint
    ELSE 50
  END;
  v_quality_score := CASE
    WHEN COALESCE(v_metadata->>'quality_score', '') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN LEAST(100, GREATEST(0, (v_metadata->>'quality_score')::numeric))
    ELSE 70
  END;
  v_sensitivity_tier := COALESCE(NULLIF(v_metadata->>'sensitivity_tier', ''), 'standard');
  v_status := COALESCE(NULLIF(p_payload->>'status', ''), NULLIF(v_metadata->>'status', ''));
  IF v_status IS NULL AND v_type IN ('task', 'idea') THEN
    v_status := 'new';
  END IF;

  -- 2.6 SHA256 Fingerprinting
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  INSERT INTO public.thoughts (
    content,
    content_fingerprint,
    metadata,
    type,
    source_type,
    importance,
    quality_score,
    sensitivity_tier,
    status,
    status_updated_at
  )
  VALUES (
    p_content,
    v_fingerprint,
    v_metadata,
    v_type,
    v_source_type,
    v_importance,
    v_quality_score,
    v_sensitivity_tier,
    v_status,
    CASE WHEN v_status IS NULL THEN NULL ELSE now() END
  )
  ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO UPDATE
  SET updated_at = now(),
      metadata = public.thoughts.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
      type = COALESCE(EXCLUDED.type, public.thoughts.type),
      source_type = COALESCE(EXCLUDED.source_type, public.thoughts.source_type),
      importance = COALESCE(EXCLUDED.importance, public.thoughts.importance),
      quality_score = COALESCE(EXCLUDED.quality_score, public.thoughts.quality_score),
      sensitivity_tier = COALESCE(EXCLUDED.sensitivity_tier, public.thoughts.sensitivity_tier),
      status = COALESCE(EXCLUDED.status, public.thoughts.status),
      status_updated_at = CASE
        WHEN EXCLUDED.status IS DISTINCT FROM public.thoughts.status THEN now()
        ELSE public.thoughts.status_updated_at
      END
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.upsert_thought(TEXT, JSONB) TO service_role;


-- ============================================================================
-- SCHEMA 5: provenance-chains
-- Adds derivation tracking, constraints, GIN indices, and walking helper RPCs.
-- ============================================================================

-- 1. COLUMNS
ALTER TABLE public.thoughts ADD COLUMN IF NOT EXISTS derived_from JSONB;
ALTER TABLE public.thoughts ADD COLUMN IF NOT EXISTS derivation_method TEXT;
ALTER TABLE public.thoughts ADD COLUMN IF NOT EXISTS derivation_layer TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE public.thoughts ADD COLUMN IF NOT EXISTS supersedes UUID REFERENCES public.thoughts(id) ON DELETE SET NULL;

-- 2. CONSTRAINTS
ALTER TABLE public.thoughts DROP CONSTRAINT IF EXISTS thoughts_derivation_layer_check;
ALTER TABLE public.thoughts ADD CONSTRAINT thoughts_derivation_layer_check CHECK (derivation_layer IN ('primary', 'derived'));

ALTER TABLE public.thoughts DROP CONSTRAINT IF EXISTS thoughts_derivation_method_check;
ALTER TABLE public.thoughts ADD CONSTRAINT thoughts_derivation_method_check CHECK (derivation_method IS NULL OR derivation_method = 'synthesis');

ALTER TABLE public.thoughts DROP CONSTRAINT IF EXISTS thoughts_derived_from_is_array_check;
ALTER TABLE public.thoughts ADD CONSTRAINT thoughts_derived_from_is_array_check CHECK (derived_from IS NULL OR jsonb_typeof(derived_from) = 'array');

ALTER TABLE public.thoughts DROP CONSTRAINT IF EXISTS thoughts_derived_from_uuid_elements_check;

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_thoughts_derived_from ON public.thoughts USING gin (derived_from);
CREATE INDEX IF NOT EXISTS idx_thoughts_derivation_layer ON public.thoughts (derivation_layer);
CREATE INDEX IF NOT EXISTS idx_thoughts_supersedes ON public.thoughts (supersedes) WHERE supersedes IS NOT NULL;

-- 4. COLUMN COMMENTS
COMMENT ON COLUMN public.thoughts.derived_from IS 'JSONB array of parent thought IDs (UUID strings). NULL for primary thoughts. Use @> for lookup.';
COMMENT ON COLUMN public.thoughts.derivation_method IS 'How this thought was derived. Currently: ''synthesis'' or NULL.';
COMMENT ON COLUMN public.thoughts.derivation_layer IS '''primary'' (atomic capture) or ''derived'' (regenerable artifact).';
COMMENT ON COLUMN public.thoughts.supersedes IS 'UUID of the prior thought this replaces.';

-- 5. TRACE PROVENANCE RPC
CREATE OR REPLACE FUNCTION public.trace_provenance(
  p_thought_id UUID,
  p_max_depth INT DEFAULT 3,
  p_node_cap INT DEFAULT 250
)
RETURNS TABLE (
  thought_id UUID,
  depth INT,
  parent_id UUID,
  content TEXT,
  type TEXT,
  source_type TEXT,
  derivation_method TEXT,
  derivation_layer TEXT,
  sensitivity_tier TEXT,
  created_at TIMESTAMPTZ,
  cycle BOOLEAN,
  restricted BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_depth INT := GREATEST(1, LEAST(COALESCE(p_max_depth, 3), 10));
  v_node_cap INT := GREATEST(1, LEAST(COALESCE(p_node_cap, 250), 2000));
BEGIN
  IF p_thought_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH RECURSIVE walk AS (
    SELECT
      t.id                                 AS thought_id,
      0                                    AS depth,
      NULL::uuid                           AS parent_id,
      t.content,
      COALESCE(t.type, (t.metadata->>'type')) AS type,
      COALESCE(t.source_type, (t.metadata->>'source_type')) AS source_type,
      t.derivation_method,
      t.derivation_layer,
      COALESCE(t.sensitivity_tier, (t.metadata->>'sensitivity_tier')) AS sensitivity_tier,
      t.created_at,
      t.derived_from,
      ARRAY[t.id]                          AS visited,
      false                                AS cycle
    FROM public.thoughts t
    WHERE t.id = p_thought_id

    UNION ALL

    SELECT
      parent.id,
      w.depth + 1,
      w.thought_id,
      parent.content,
      COALESCE(parent.type, (parent.metadata->>'type')) AS type,
      COALESCE(parent.source_type, (parent.metadata->>'source_type')) AS source_type,
      parent.derivation_method,
      parent.derivation_layer,
      COALESCE(parent.sensitivity_tier, (parent.metadata->>'sensitivity_tier')) AS sensitivity_tier,
      parent.created_at,
      parent.derived_from,
      w.visited || parent.id,
      parent.id = ANY(w.visited)
    FROM walk w
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(w.derived_from, '[]'::jsonb)) AS p(parent_id_text)
    JOIN public.thoughts parent ON parent.id = p.parent_id_text::uuid
    WHERE w.depth < v_max_depth
      AND NOT w.cycle
  )
  SELECT
    walk.thought_id,
    walk.depth,
    walk.parent_id,
    CASE WHEN walk.sensitivity_tier = 'restricted' THEN NULL ELSE walk.content END AS content,
    walk.type,
    walk.source_type,
    walk.derivation_method,
    walk.derivation_layer,
    walk.sensitivity_tier,
    walk.created_at,
    walk.cycle,
    (walk.sensitivity_tier = 'restricted') AS restricted
  FROM walk
  ORDER BY depth ASC, thought_id ASC
  LIMIT v_node_cap;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trace_provenance(UUID, INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trace_provenance(UUID, INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trace_provenance(UUID, INT, INT) TO service_role;

-- 6. FIND DERIVATIVES RPC
DROP FUNCTION IF EXISTS public.find_derivatives(UUID, INT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.find_derivatives(
  p_thought_id UUID,
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  type TEXT,
  source_type TEXT,
  derivation_method TEXT,
  derivation_layer TEXT,
  sensitivity_tier TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_needle JSONB;
BEGIN
  IF p_thought_id IS NULL THEN
    RETURN;
  END IF;

  v_needle := jsonb_build_array(p_thought_id::text);

  RETURN QUERY
  SELECT
    t.id,
    t.content,
    COALESCE(t.type, (t.metadata->>'type')) AS type,
    COALESCE(t.source_type, (t.metadata->>'source_type')) AS source_type,
    t.derivation_method,
    t.derivation_layer,
    COALESCE(t.sensitivity_tier, (t.metadata->>'sensitivity_tier')) AS sensitivity_tier,
    t.created_at
  FROM public.thoughts t
  WHERE t.derived_from @> v_needle
    AND COALESCE(t.sensitivity_tier, (t.metadata->>'sensitivity_tier')) IS DISTINCT FROM 'restricted'
  ORDER BY t.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_derivatives(UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_derivatives(UUID, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_derivatives(UUID, INT) TO service_role;

-- 7. MERGE PROVENANCE METADATA RPC
CREATE OR REPLACE FUNCTION public.merge_thought_provenance_metadata(
  p_thought_id UUID,
  p_provenance JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rows_affected INT;
BEGIN
  IF p_thought_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.thoughts
  SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                 jsonb_build_object(
                   'provenance',
                   COALESCE(metadata->'provenance', '{}'::jsonb) || COALESCE(p_provenance, '{}'::jsonb)
                 )
  WHERE id = p_thought_id;

  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  IF rows_affected = 0 THEN
    RAISE EXCEPTION 'Thought % not found', p_thought_id USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_thought_provenance_metadata(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_thought_provenance_metadata(UUID, JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.merge_thought_provenance_metadata(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_thought_provenance_metadata(UUID, JSONB) TO service_role;

-- 8. MERGE EVAL METADATA RPC
CREATE OR REPLACE FUNCTION public.merge_thought_eval_metadata(
  p_thought_id UUID,
  p_eval JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rows_affected INT;
BEGIN
  IF p_thought_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.thoughts
  SET metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_eval, '{}'::jsonb)
  WHERE id = p_thought_id;

  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  IF rows_affected = 0 THEN
    RAISE EXCEPTION 'Thought % not found', p_thought_id USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_thought_eval_metadata(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_thought_eval_metadata(UUID, JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.merge_thought_eval_metadata(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_thought_eval_metadata(UUID, JSONB) TO service_role;


-- ============================================================================
-- SCHEMA REFRESH & VALIDATION HELPER
-- Notify PostgREST to refresh its schema representation, and install
-- check_enhanced_schemas() so validation can run over HTTPS (bypassing psql/IP blocks)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_enhanced_schemas()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, information_schema
AS $$
DECLARE
  v_result JSONB;
  v_tables JSONB;
  v_columns JSONB;
  v_functions JSONB;
  v_extensions JSONB;
  v_indexes JSONB;
BEGIN
  -- 1. Check Tables
  SELECT jsonb_build_object(
    'ingestion_jobs', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ingestion_jobs'),
    'ingestion_items', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ingestion_items')
  ) INTO v_tables;

  -- 2. Check Columns on thoughts
  SELECT jsonb_build_object(
    'type', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'type'),
    'sensitivity_tier', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'sensitivity_tier'),
    'importance', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'importance'),
    'quality_score', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'quality_score'),
    'source_type', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'source_type'),
    'enriched', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'enriched'),
    'status', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'status'),
    'status_updated_at', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'status_updated_at'),
    'derived_from', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'derived_from'),
    'derivation_method', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'derivation_method'),
    'derivation_layer', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'derivation_layer'),
    'supersedes', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'thoughts' AND column_name = 'supersedes')
  ) INTO v_columns;

  -- 3. Check Functions
  SELECT jsonb_build_object(
    'append_thought_evidence', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'append_thought_evidence'),
    'search_thoughts_text', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'search_thoughts_text'),
    'brain_stats_aggregate', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'brain_stats_aggregate'),
    'get_thought_connections', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'get_thought_connections'),
    'backfill_thought_types', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'backfill_thought_types'),
    'trace_provenance', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'trace_provenance'),
    'find_derivatives', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'find_derivatives'),
    'merge_thought_provenance_metadata', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'merge_thought_provenance_metadata'),
    'merge_thought_eval_metadata', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'merge_thought_eval_metadata')
  ) INTO v_functions;

  -- 4. Check Extensions
  SELECT jsonb_build_object(
    'pg_trgm', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')
  ) INTO v_extensions;

  -- 5. Check Indexes
  SELECT jsonb_build_object(
    'idx_thoughts_content_trgm', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'thoughts' AND indexname = 'idx_thoughts_content_trgm'),
    'idx_thoughts_content_tsvector', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'thoughts' AND indexname = 'idx_thoughts_content_tsvector'),
    'idx_thoughts_derived_from', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'thoughts' AND indexname = 'idx_thoughts_derived_from'),
    'idx_thoughts_status', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'thoughts' AND indexname = 'idx_thoughts_status')
  ) INTO v_indexes;

  -- Combine all
  v_result := jsonb_build_object(
    'tables', v_tables,
    'columns', v_columns,
    'functions', v_functions,
    'extensions', v_extensions,
    'indexes', v_indexes
  );

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_enhanced_schemas() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_enhanced_schemas() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.check_enhanced_schemas() FROM anon;
GRANT EXECUTE ON FUNCTION public.check_enhanced_schemas() TO service_role;

NOTIFY pgrst, 'reload schema';
