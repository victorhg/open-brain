# Agent Memory Schema Deployment Guide

## Overview
This guide will deploy the Agent Memory schema to your Supabase database. The schema adds 8 tables for governed agent operational memory with provenance tracking, review workflows, and audit trails.

## Prerequisites
✅ Supabase project created  
✅ Core `thoughts` table deployed  
✅ `psql` client installed (confirmed)  
✅ Database password available  

## What Will Be Deployed

### Tables (8 total):
1. **agent_memories** - Core governed memory storage
2. **agent_memory_source_refs** - Source reference tracking
3. **agent_memory_artifacts** - Artifact references
4. **agent_memory_relations** - Memory relationships (supersedes, conflicts, etc.)
5. **agent_memory_review_actions** - Review audit trail
6. **agent_memory_recall_traces** - Recall request traces
7. **agent_memory_recall_items** - Individual recalled items
8. **agent_memory_audit_events** - Complete audit log

### Features:
- ✅ Row Level Security (RLS) enabled on all tables
- ✅ Service role policies for full access
- ✅ Proper indexes for performance
- ✅ Foreign key constraints
- ✅ CHECK constraints for data validation
- ✅ Auto-updating timestamps
- ✅ Content hash function for deduplication

## Database Password

You'll need your Supabase database password. To find it:

### Option 1: Check your credential tracker
If you saved it during initial setup, it's in your Open Brain credential tracker spreadsheet.

### Option 2: Reset via Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to: Settings → Database
4. Click "Reset database password"
5. Save the new password in your `.env` file as:
   ```
   SUPABASE_DB_PASSWORD=your_password_here
   ```

### Option 3: Have it ready to paste
The deployment script will prompt for it if not found in `.env`.

## Deployment Command

Run:
```bash
bash schemas/agent-memory/deploy-psql.sh
```

## What Happens

1. **Validate environment** - Checks .env for SUPABASE_URL
2. **Extract project reference** - Gets your project ID from the URL
3. **Prompt for password** - If not in .env, asks for it
4. **Connect via psql** - Establishes secure connection to Supabase PostgreSQL
5. **Execute schema.sql** - Creates all tables, indexes, and policies
6. **Run validation** - Tests all tables and inserts sample data
7. **Cleanup** - Removes test data
8. **Print summary** - Shows what was created

## Expected Output

```
🚀 Agent Memory Schema Deployment
==================================

📋 Project: your-project-ref

📦 Deploying schema...

BEGIN
DO
CREATE TABLE
CREATE INDEX
... (many more CREATE statements)
COMMIT

✅ Schema deployed successfully!

🔍 Running validation...

📋 Step 1: Checking prerequisites...
✓ thoughts table exists

🔍 Step 3: Verifying tables were created...
   ✓ agent_memories - exists
   ✓ agent_memory_source_refs - exists
   ... (8 tables total)

✓ All 8 tables verified

🧪 Step 4: Testing sample data insertion...
✓ Test memory inserted
✓ Source reference inserted
✓ Audit event inserted

✅ Step 5: Running validation queries...
✓ Memory retrieval works
✓ Source reference query works
✓ Audit event query works
✓ CHECK constraints enforced

🧹 Step 6: Cleaning up test data...
✓ Test data cleaned up

============================================================
📊 AGENT MEMORY SCHEMA VALIDATION SUMMARY
============================================================

Total memories in database: 0

Schema Status:
  ✓ agent_memories - Core memory table
  ✓ agent_memory_source_refs - Source tracking
  ... (all 8 tables)

Capabilities Enabled:
  ✓ Governed memory storage with provenance
  ✓ Review workflow (pending → confirmed)
  ✓ Use policy controls (instruction vs evidence)
  ✓ Recall tracing and audit
  ✓ Source reference tracking
  ✓ Content deduplication via hash

✅ Agent Memory schema validation PASSED

✅ Phase 1, Task 1 complete!
```

## Troubleshooting

### "FATAL: password authentication failed"
- Your database password is incorrect
- Reset it in Supabase Dashboard → Settings → Database
- Update .env with: `SUPABASE_DB_PASSWORD=new_password`

### "FATAL: no pg_hba.conf entry for host"
- Your IP address is not allowed
- Go to: Supabase Dashboard → Settings → Database
- Scroll to "Connection Security"
- Either: Add your IP, or temporarily enable "Allow all IPs" for deployment

### "ERROR: relation 'thoughts' does not exist"
- Core Open Brain setup not complete
- Run the getting-started guide first
- Ensure `thoughts` table exists in your database

### Connection times out
- Check your internet connection
- Verify the project URL is correct in .env
- Check Supabase status: https://status.supabase.com

## After Deployment

### Verify in Supabase Dashboard
1. Go to: Table Editor
2. You should see 8 new tables starting with `agent_memory*`
3. Click on `agent_memories` to see the schema

### Next Steps
- [ ] Mark Task 1.1 as complete in TASKS.md
- [ ] Proceed to Task 1.2: Deploy Enhanced Schemas
- [ ] Consider deploying agent-memory-api integration

## Files Created
- `schemas/agent-memory/deploy-psql.sh` - Deployment script
- `schemas/agent-memory/validate.js` - Validation script
- `schemas/agent-memory/package.json` - Dependencies
- `schemas/agent-memory/DEPLOYMENT.md` - This guide

## Schema Details
Full schema documentation: `schemas/agent-memory/README.md`  
Source SQL: `schemas/agent-memory/schema.sql` (328 lines)
