# Phase 1, Task 1.2: Enhanced Schemas Deployment

**Status:** Ready for Deployment  
**Date:** 2026-07-13  
**Deployment Method:** Supabase Dashboard SQL Editor (psql access blocked by IP restrictions)

---

## Overview

This document guides the deployment of 5 critical schemas that enhance Open Brain's core functionality:

1. **smart-ingest** - Content fingerprint deduplication (prevents duplicate thoughts)
2. **text-search-trgm** - Trigram full-text search indexes (~150ms vs ~8s queries)
3. **enhanced-thoughts** - Structured metadata columns + search utilities
4. **workflow-status** - Task/idea status tracking for kanban workflows
5. **provenance-chains** - Derivation tracking for synthesized thoughts

---

## Prerequisites

- ✅ Supabase project: `aekvtnyciybockeytbmf`
- ✅ Core `thoughts` table deployed
- ✅ Agent-memory schema deployed (Task 1.1 complete)
- ⚠️ Direct psql connection not available (use Dashboard SQL Editor)

---

## Deployment Order

**CRITICAL:** Deploy in this exact order due to dependencies:

```mermaid
graph LR
    A[1. smart-ingest] --> B[2. text-search-trgm]
    B --> C[3. enhanced-thoughts]
    C --> D[4. workflow-status]
    D --> E[5. provenance-chains]
```

### Why This Order?

- **smart-ingest** is standalone (ingestion pipeline, no dependencies)
- **text-search-trgm** requires `pg_trgm` extension (installs independently)
- **enhanced-thoughts** depends on text-search-trgm for the `search_thoughts_text` RPC
- **workflow-status** adds columns that provenance-chains may reference
- **provenance-chains** reads metadata columns that enhanced-thoughts standardizes

---

## Deployment Steps

### Schema 1: smart-ingest (Content Fingerprint Dedup)

**Purpose:** Prevents duplicate thoughts via SHA256 content hashing  
**Impact:** Critical for data quality—prevents re-importing the same content  
**Time:** ~2 minutes

1. Navigate to [Supabase Dashboard](https://supabase.com/dashboard/project/aekvtnyciybockeytbmf/editor)
2. Click **SQL Editor** in sidebar
3. Create new query, paste contents of `schemas/smart-ingest/schema.sql`
4. Click **Run** (creates `ingestion_jobs`, `ingestion_items`, `append_thought_evidence` RPC)
5. Verify:
   ```sql
   SELECT count(*) FROM ingestion_jobs;
   -- Should return 0 for fresh install
   
   SELECT proname FROM pg_proc WHERE proname = 'append_thought_evidence';
   -- Should return 1 row
   ```

**Expected Tables:**
- `ingestion_jobs` - Tracks bulk ingest lifecycle with status/counters
- `ingestion_items` - Individual extracted thoughts with dedup actions

**Expected Functions:**
- `append_thought_evidence(thought_id BIGINT, evidence JSONB)` - SHA256-based evidence append

---

### Schema 2: text-search-trgm (Trigram Search Index)

**Purpose:** 50x faster ILIKE queries via `pg_trgm` GIN indexes  
**Impact:** search_thoughts_text drops from ~8s to ~150ms on 90K+ thoughts  
**Time:** ~1-2 minutes (includes brief table lock for index build)

1. Open **SQL Editor** in Supabase Dashboard
2. Paste contents of `schemas/text-search-trgm/schema.sql`
3. Click **Run** (installs `pg_trgm` extension, builds trigram index)
4. **Important:** After completion, run this in a NEW query (cannot run in same transaction):
   ```sql
   ANALYZE public.thoughts;
   ```
5. Verify index is being used:
   ```sql
   EXPLAIN ANALYZE
   SELECT id FROM public.thoughts
   WHERE content ILIKE '%example%'
   LIMIT 25;
   
   -- Look for "Bitmap Index Scan on idx_thoughts_content_trgm" in output
   ```

**Expected Extensions:**
- `pg_trgm` enabled

**Expected Indexes:**
- `idx_thoughts_content_trgm` on `thoughts(content)` using GIN

**⚠️ Note:** Index build briefly locks `thoughts` table (~1-2 min). If live capture is running, consider off-peak deployment.

---

### Schema 3: enhanced-thoughts (Metadata Columns + Search RPCs)

**Purpose:** Adds structured columns (`type`, `importance`, `quality_score`) + 4 utility RPCs  
**Impact:** Eliminates JSONB parsing overhead, enables fast filtering/ranking  
**Time:** ~2 minutes

1. Open **SQL Editor**
2. Paste contents of `schemas/enhanced-thoughts/schema.sql`
3. Click **Run**
4. Verify columns exist:
   ```sql
   SELECT column_name, data_type, column_default
   FROM information_schema.columns
   WHERE table_name = 'thoughts'
     AND column_name IN ('type', 'sensitivity_tier', 'importance', 'quality_score', 'source_type', 'enriched');
   ```
5. Test backfill (should auto-run, but verify):
   ```sql
   SELECT type, count(*) FROM thoughts WHERE type IS NOT NULL GROUP BY type;
   ```

**Expected Columns:**
- `type` TEXT (nullable, populated from `metadata->>'type'`)
- `sensitivity_tier` TEXT DEFAULT 'standard'
- `importance` SMALLINT DEFAULT 3
- `quality_score` NUMERIC(5,2) DEFAULT 50
- `source_type` TEXT (nullable)
- `enriched` BOOLEAN DEFAULT false

**Expected Functions:**
- `search_thoughts_text(p_query TEXT, ...)` - Full-text search with pagination
- `brain_stats_aggregate(p_since_days INT, ...)` - Aggregate stats
- `get_thought_connections(p_thought_id UUID, ...)` - Find related thoughts
- `backfill_thought_types(p_allowed_types TEXT[])` - Type column backfill

---

### Schema 4: workflow-status (Task/Idea Status Tracking)

**Purpose:** Adds kanban-style workflow columns for task/idea management  
**Impact:** Enables workflow board in dashboard, powers `progress_task` MCP tool  
**Time:** ~1 minute

1. Open **SQL Editor**
2. Paste contents of `schemas/workflow-status/schema.sql`
3. Click **Run**
4. Verify columns and backfill:
   ```sql
   SELECT column_name, data_type, column_default
   FROM information_schema.columns
   WHERE table_name = 'thoughts'
     AND column_name IN ('status', 'status_updated_at');
   
   -- Check backfill worked for existing tasks/ideas
   SELECT status, count(*)
   FROM thoughts
   WHERE type IN ('task', 'idea')
   GROUP BY status;
   ```

**Expected Columns:**
- `status` TEXT (nullable, only for task/idea types)
- `status_updated_at` TIMESTAMPTZ

**Valid Statuses:**
- `new`, `planning`, `active`, `review`, `done`, `archived`

**Expected Indexes:**
- `idx_thoughts_status` (partial, only WHERE status IS NOT NULL)

---

### Schema 5: provenance-chains (Derivation Tracking)

**Purpose:** Tracks which thoughts were derived from which sources  
**Impact:** Enables citation chains for synthesized content (digests, wikis, summaries)  
**Time:** ~2 minutes

1. Open **SQL Editor**
2. Paste contents of `schemas/provenance-chains/schema.sql`
3. Click **Run**
4. Verify columns exist:
   ```sql
   SELECT column_name, data_type, column_default
   FROM information_schema.columns
   WHERE table_name = 'thoughts'
     AND column_name IN ('derived_from', 'derivation_method', 'derivation_layer', 'supersedes');
   ```
5. Verify all existing thoughts marked as 'primary':
   ```sql
   SELECT derivation_layer, count(*) FROM thoughts GROUP BY 1;
   -- Should show all rows as 'primary'
   ```
6. Test helper functions (these are service_role only):
   ```sql
   -- Should return depth=0 row for an existing thought
   SELECT * FROM public.trace_provenance(
     (SELECT id FROM public.thoughts LIMIT 1),
     3,   -- max_depth
     250  -- node_cap
   );
   ```

**Expected Columns:**
- `derived_from` JSONB (array of parent thought UUIDs)
- `derivation_method` TEXT (constrained to 'synthesis' or NULL initially)
- `derivation_layer` TEXT NOT NULL DEFAULT 'primary'
- `supersedes` UUID (points to replaced thought)

**Expected Functions (SECURITY DEFINER, service_role only):**
- `trace_provenance(thought_id UUID, max_depth INT, node_cap INT)` - Walk ancestry tree
- `find_derivatives(thought_id UUID, limit INT)` - Reverse lookup (what cites this?)
- `merge_thought_provenance_metadata(thought_id UUID, provenance JSONB)` - Race-free metadata merge
- `merge_thought_eval_metadata(thought_id UUID, eval JSONB)` - Race-free eval metadata merge

**Expected Indexes:**
- `idx_thoughts_derived_from` (GIN for array containment)
- `idx_thoughts_derivation_layer` (btree)
- `idx_thoughts_supersedes` (partial btree)

---

## Post-Deployment Validation

After deploying all 5 schemas, run this comprehensive validation:

```sql
-- 1. Verify all new tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('ingestion_jobs', 'ingestion_items')
ORDER BY table_name;
-- Expected: 2 rows

-- 2. Verify all new columns exist on thoughts
SELECT column_name FROM information_schema.columns
WHERE table_name = 'thoughts'
  AND column_name IN (
    'type', 'sensitivity_tier', 'importance', 'quality_score', 'source_type', 'enriched',
    'status', 'status_updated_at',
    'derived_from', 'derivation_method', 'derivation_layer', 'supersedes'
  )
ORDER BY column_name;
-- Expected: 12 rows

-- 3. Verify all new functions exist
SELECT proname FROM pg_proc
WHERE proname IN (
  'append_thought_evidence',
  'search_thoughts_text',
  'brain_stats_aggregate',
  'get_thought_connections',
  'backfill_thought_types',
  'trace_provenance',
  'find_derivatives',
  'merge_thought_provenance_metadata',
  'merge_thought_eval_metadata'
)
ORDER BY proname;
-- Expected: 9 rows

-- 4. Verify pg_trgm extension enabled
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
-- Expected: 1 row

-- 5. Check thought counts by new fields
SELECT
  COUNT(*) as total_thoughts,
  COUNT(type) as thoughts_with_type,
  COUNT(status) as thoughts_with_status,
  COUNT(CASE WHEN derivation_layer = 'primary' THEN 1 END) as primary_thoughts
FROM thoughts;
-- All existing thoughts should show derivation_layer = 'primary'
```

---

## Validation Script

Create a Node.js validation script:

```bash
cd schemas
cat > validate-phase1-task1.2.js << 'EOF'
#!/usr/bin/env node
import pg from 'pg';
import { config } from 'dotenv';

config({ path: '../.env' });

const { Client } = pg;
const client = new Client({
  connectionString: process.env.SUPABASE_URL?.replace('https://', 'postgresql://postgres:' + process.env.SUPABASE_DB_PASSWORD + '@') + '.supabase.co:5432/postgres',
});

const checks = [
  {
    name: 'Ingestion tables exist',
    query: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ingestion_jobs', 'ingestion_items') ORDER BY table_name`,
    expect: rows => rows.length === 2
  },
  {
    name: 'Enhanced thoughts columns exist',
    query: `SELECT column_name FROM information_schema.columns WHERE table_name = 'thoughts' AND column_name IN ('type', 'sensitivity_tier', 'importance', 'quality_score', 'source_type', 'enriched') ORDER BY column_name`,
    expect: rows => rows.length === 6
  },
  {
    name: 'Workflow columns exist',
    query: `SELECT column_name FROM information_schema.columns WHERE table_name = 'thoughts' AND column_name IN ('status', 'status_updated_at') ORDER BY column_name`,
    expect: rows => rows.length === 2
  },
  {
    name: 'Provenance columns exist',
    query: `SELECT column_name FROM information_schema.columns WHERE table_name = 'thoughts' AND column_name IN ('derived_from', 'derivation_method', 'derivation_layer', 'supersedes') ORDER BY column_name`,
    expect: rows => rows.length === 4
  },
  {
    name: 'pg_trgm extension enabled',
    query: `SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`,
    expect: rows => rows.length === 1
  },
  {
    name: 'All RPC functions exist',
    query: `SELECT proname FROM pg_proc WHERE proname IN ('append_thought_evidence', 'search_thoughts_text', 'brain_stats_aggregate', 'get_thought_connections', 'backfill_thought_types', 'trace_provenance', 'find_derivatives', 'merge_thought_provenance_metadata', 'merge_thought_eval_metadata') ORDER BY proname`,
    expect: rows => rows.length === 9
  },
  {
    name: 'Trigram index exists',
    query: `SELECT indexname FROM pg_indexes WHERE indexname = 'idx_thoughts_content_trgm'`,
    expect: rows => rows.length === 1
  }
];

async function validate() {
  await client.connect();
  console.log('🔍 Phase 1, Task 1.2 Validation\n');
  
  let passed = 0, failed = 0;
  
  for (const check of checks) {
    try {
      const result = await client.query(check.query);
      if (check.expect(result.rows)) {
        console.log(`✅ ${check.name}`);
        passed++;
      } else {
        console.log(`❌ ${check.name} (unexpected result count)`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ ${check.name} (${err.message})`);
      failed++;
    }
  }
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  await client.end();
  process.exit(failed > 0 ? 1 : 0);
}

validate();
EOF

chmod +x validate-phase1-task1.2.js
```

---

## Expected Impact

After deploying all 5 schemas:

✅ **Data Quality:** Smart-ingest prevents duplicate thoughts via fingerprinting  
✅ **Search Performance:** 50x faster full-text queries (8s → 150ms)  
✅ **Structured Metadata:** Type-safe filtering without JSONB parsing  
✅ **Task Management:** Kanban workflows for task/idea thoughts  
✅ **Traceability:** Full provenance chains for derived content  

---

## Troubleshooting

### Issue: "relation already exists" warnings
**Solution:** Safe to ignore. Schemas use `IF NOT EXISTS` for idempotency.

### Issue: Text search still slow after text-search-trgm
**Solution:** Run `ANALYZE public.thoughts;` in a separate query (cannot run in migration transaction).

### Issue: Existing thoughts missing 'type' values
**Solution:** The `backfill_thought_types()` function should auto-run. If not:
```sql
SELECT backfill_thought_types(ARRAY['idea','task','person_note','reference','decision','lesson','meeting','journal']);
```

### Issue: Cannot call provenance functions from PostgREST
**Solution:** These are `SECURITY DEFINER` and `service_role` only. Call them via Edge Functions, not client code.

---

## Rollback Instructions

If deployment fails and rollback is needed, see individual schema README.md files for rollback SQL.

**⚠️ WARNING:** Rollback drops columns and data. Only use for failed deployments, not after data has been captured.

---

## Next Steps

After successful deployment:

1. ✅ Run validation script: `node schemas/validate-phase1-task1.2.js`
2. ✅ Update TASKS.md to mark Task 1.2 as complete
3. ✅ Commit changes to git
4. 🎯 Begin Phase 1, Task 1.3 or Phase 2, Task 2.1 (Household Knowledge extension)

---

**Deployment Time Estimate:** 10-15 minutes total  
**Deployed by:** OB1 Orchestrator (pi)  
**Date:** 2026-07-13
