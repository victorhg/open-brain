# Smoke Test Handoff Report (2026-07-16)

## Scope
Ran the Open Brain smoke harness for schema and Supabase validation using the existing recipe setup.

- Workspace: /Users/victorhugogermano/Development/openbrain
- Harness: recipes/brain-smoke-test/smoke-all.js
- Env source: recipes/brain-smoke-test/.env.local

## Commands Executed
1. `cd /Users/victorhugogermano/Development/openbrain/recipes/brain-smoke-test && node smoke-all.js`
2. `cd /Users/victorhugogermano/Development/openbrain/recipes/brain-smoke-test && node smoke-all.js --json`
3. Direct RPC reproduction for full error body (POST to /rest/v1/rpc/match_thoughts)

## Outcome Summary
- Result: FAIL
- Totals: 18 pass, 9 skip, 1 fail (28 total)
- Single failure category: DB Schema
- Failing check: match_thoughts RPC

## Failure Details
PostgREST returned ambiguous RPC resolution:

- code: PGRST203
- message: Could not choose the best candidate function
- candidates:
  - public.match_thoughts(query_embedding => extensions.vector, match_threshold => double precision, match_count => integer)
  - public.match_thoughts(query_embedding => extensions.vector, match_threshold => double precision, match_count => integer, filter => jsonb)

Interpretation: there are overloaded `match_thoughts` signatures in the target database, and PostgREST cannot resolve the call unambiguously from current payload.

## What Passed (high signal)
- MCP endpoint and JSON-RPC handshake
- Core MCP tools listing
- thoughts table and canonical columns checks
- upsert_thought RPC callable
- Auth checks for missing/wrong/correct MCP key
- PostgREST access-key enforcement
- Anon-key RLS probe returned 0 rows (filtering behavior appears correct)

## What Skipped
Expected optional-surface skips:
- REST API checks (not installed / NEXT_PUBLIC_API_URL unset)
- ob-graph tables (graph_nodes, graph_edges) not installed
- pg_class_rls helper RPC not installed
- Core Features destructive path not run (default safe mode)

## Evidence Links in Workspace
- Smoke test usage and required env: recipes/brain-smoke-test/README.md
- Failing check implementation: recipes/brain-smoke-test/smoke-all.js
- Existing local SQL artifact with match_thoughts definition: update_match_thoughts.sql
- MCP currently calling match_thoughts_v2 internally: supabase/functions/open-brain-mcp/index.ts

## Recommended Next Actions for Next Agent
1. Inspect live database function list/signatures for `public.match_thoughts` and confirm all overloads currently deployed.
2. Decide on canonical RPC contract:
   - Option A: keep one `match_thoughts` signature and remove/rename others.
   - Option B: keep overloads but make smoke harness call unambiguous payload/signature.
   - Option C: migrate callers/tests to `match_thoughts_v2` and retire ambiguous legacy name.
3. Apply SQL migration in a controlled way and redeploy function metadata if needed.
4. Re-run:
   - `node recipes/brain-smoke-test/smoke-all.js`
   - Optional: `node recipes/brain-smoke-test/smoke-all.js --destructive` in non-prod environment.

## Notes
- No destructive smoke checks were executed in this run.
- This report captures run-state for agent handoff only; no schema changes were made during diagnosis.
