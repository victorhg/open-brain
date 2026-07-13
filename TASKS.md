# OpenBrain (OB1) Implementation Roadmap

> **Status:** Brain smoke test passed ✓ | Core MCP deployed ✓ | 3911 thoughts imported ✓

This document outlines the implementation roadmap for completing the OpenBrain architecture based on the original [OB1 framework by Nate B. Jones](https://github.com/NateBJones-Projects/OB1).

---

## Current Implementation Status

### ✅ Completed
- **Core Infrastructure**
  - Supabase project configured
  - Core `thoughts` table with vector embeddings
  - MCP Edge Function deployed (`open-brain-mcp`)
  - Brain smoke test passing (17 pass, 11 skip, 0 fail)
  - 3911 thoughts successfully imported

- **Schemas**
  - `agent-memory` schema available (not yet deployed)

- **Recipes**
  - `brain-smoke-test` - System validation harness
  - `obsidian-vault-import` - Successfully imported 3909 thoughts
  - `auto-capture` - Session capture protocol
  - `panning-for-gold` - Brain dump processing

- **Primitives**
  - All core primitives available (deploy-edge-function, remote-mcp, rls, shared-mcp, troubleshooting)

### ❌ Missing
- **Extensions** - 0 of 6 core extensions deployed
- **Schemas** - 1 of 15 schemas deployed
- **Integrations** - No capture sources configured (Slack, Discord, etc.)
- **Dashboard** - No web interface deployed
- **Advanced Recipes** - 4 of 50+ recipes available

---

## Phase 1: Core Schema & Infrastructure (Priority: Critical)

### ✅ Task 1.1: Deploy Agent Memory Schema [COMPLETE]
**Objective:** Enable governed operational memory for agent runtimes with provenance tracking.

**Status:** DEPLOYED AND VALIDATED
- ✅ All 8 tables created and operational
- ✅ Validation passed (17/17 checks)
- ✅ Test data insertion successful
- ✅ RLS policies active
- ✅ Constraints enforced
- ✅ 2 memories already in database

**Tables Deployed:**
1. `agent_memories` - Core memory storage
2. `agent_memory_source_refs` - Source tracking
3. `agent_memory_artifacts` - Artifact references
4. `agent_memory_relations` - Memory relationships
5. `agent_memory_review_actions` - Review audit trail
6. `agent_memory_recall_traces` - Recall traces
7. `agent_memory_recall_items` - Recalled items
8. `agent_memory_audit_events` - Audit log

**Deployment Tools Created:**
- `schemas/agent-memory/check-tables.js` - Quick status check
- `schemas/agent-memory/validate.js` - Full validation suite
- `schemas/agent-memory/deploy-psql.sh` - Deployment script
- `schemas/agent-memory/DEPLOYMENT.md` - Deployment guide

**Time Taken:** ~1 hour (including tooling creation)  
**Completed:** 2026-07-13

---

### Task 1.2: Deploy Enhanced Schemas
**Objective:** Add critical schema extensions for better knowledge management.

**Priority Order:**
1. **`content-fingerprint-dedup`** - Prevent duplicate thoughts (critical for data quality)
2. **`text-search-trgm`** - Full-text search with PostgreSQL trigram indexes
3. **`enhanced-thoughts`** - Additional metadata fields and search capabilities
4. **`workflow-status`** - Track tasks and action items from thoughts
5. **`provenance-chains`** - Track derivation and thought lineage

**Steps for each schema:**
1. Copy schema from OB1 repository to `schemas/<schema-name>/`
2. Review and adapt SQL for compatibility
3. Deploy via Supabase SQL Editor
4. Run verification queries
5. Document in schemas/README.md

**Dependencies:** Core thoughts table  
**Time Estimate:** 2-3 hours for all 5 schemas  
**Impact:** Significantly improves data quality, search, and traceability

---

## Phase 2: First Extension - Learning Path Start (Priority: High)

### Task 2.1: Household Knowledge Base (Extension #1)
**Objective:** First extension in the OB1 learning path - store home facts for instant recall.

**What This Teaches:**
- Schema design for domain-specific data
- RLS policies for data isolation
- MCP tool implementation
- Edge function updates

**Steps:**
1. Copy extension structure from OB1: `extensions/household-knowledge/`
2. Review and adapt schema SQL
3. Deploy household schema tables
4. Update MCP Edge Function with household-specific tools
5. Test capture and recall of household facts
6. Document in extensions/README.md

**Dependencies:** Core MCP function  
**Time Estimate:** 2 hours  
**Impact:** Provides working template for all future extensions

---

### Task 2.2: Home Maintenance Tracker (Extension #2)
**Objective:** Second learning path extension - maintenance scheduling and history.

**What This Teaches:**
- Time-based data models
- Recurring schedules
- Notification patterns
- Cross-table joins

**Steps:**
1. Copy extension structure from OB1: `extensions/home-maintenance/`
2. Deploy maintenance schema
3. Add MCP tools for maintenance tracking
4. Test schedule creation and reminders
5. Document integration patterns

**Dependencies:** Household Knowledge Base extension  
**Time Estimate:** 2-3 hours  
**Impact:** Demonstrates interconnected extensions

---

## Phase 3: Data Import & Quality (Priority: High)

### Task 3.1: Deploy ChatGPT Conversation Import
**Objective:** Import historical ChatGPT conversations with deduplication.

**Steps:**
1. Copy recipe from OB1: `recipes/chatgpt-conversation-import/`
2. Set up Node.js script with dependencies
3. Configure OpenRouter API for summarization
4. Run import with data export
5. Verify thoughts captured with proper metadata

**Dependencies:** Content fingerprint dedup schema  
**Time Estimate:** 1 hour  
**Impact:** Capture existing conversation history

---

### Task 3.2: Deploy Fingerprint Dedup Backfill
**Objective:** Add content fingerprints to existing thoughts and remove duplicates.

**Steps:**
1. Copy recipe from OB1: `recipes/fingerprint-dedup-backfill/`
2. Run backfill script on existing 3911 thoughts
3. Identify and safely remove duplicates
4. Document duplicate statistics

**Dependencies:** Content fingerprint dedup schema  
**Time Estimate:** 1 hour  
**Impact:** Improve data quality for existing 3911 thoughts

---

## Phase 4: MCP Client Connectivity (Priority: High)

### Task 4.1: Configure Claude Desktop MCP Connection
**Objective:** Enable Claude Desktop to access Open Brain via MCP.

**Steps:**
1. Review `primitives/remote-mcp/README.md`
2. Add MCP configuration to Claude Desktop config file
3. Test connection with `search_thoughts` and `capture_thought`
4. Document connection string format
5. Add troubleshooting section

**Dependencies:** Core MCP function  
**Time Estimate:** 30 minutes  
**Impact:** Direct Claude Desktop integration

---

### Task 4.2: Configure Cursor/Claude Code Integration
**Objective:** Enable AI coding tools to access Open Brain context.

**Steps:**
1. Configure MCP in Cursor/Claude Code settings
2. Test context retrieval during coding sessions
3. Verify thought capture works from editor
4. Document workflow patterns

**Dependencies:** Remote MCP configuration  
**Time Estimate:** 30 minutes  
**Impact:** AI-assisted coding with personal context

---

## Phase 5: Web Dashboard (Priority: Medium)

### Task 5.1: Deploy Open Brain Dashboard (Next.js)
**Objective:** Web interface for browsing, searching, and managing thoughts.

**Steps:**
1. Copy dashboard from OB1: `dashboards/open-brain-dashboard-next/`
2. Configure environment variables (.env.local)
3. Test locally with `npm run dev`
4. Deploy to Vercel or similar platform
5. Configure Supabase auth integration
6. Test all features: search, browse, stats, thought editing

**Dependencies:** Core MCP function, Supabase setup  
**Time Estimate:** 2-3 hours  
**Impact:** Visual interface for knowledge management

---

## Phase 6: Capture Integrations (Priority: Medium)

### Task 6.1: Slack Capture Integration
**Objective:** Quick-capture thoughts from Slack messages.

**Steps:**
1. Copy integration from OB1: `integrations/slack-capture/`
2. Create Slack app with slash commands
3. Deploy Slack webhook Edge Function
4. Configure OAuth tokens
5. Test capture workflow from Slack
6. Document Slack commands

**Dependencies:** Core MCP function  
**Time Estimate:** 2 hours  
**Impact:** Instant capture from primary communication tool

---

### Task 6.2: Discord Capture Integration
**Objective:** Alternative capture source for Discord users.

**Steps:**
1. Copy integration from OB1: `integrations/discord-capture/`
2. Create Discord bot application
3. Deploy Discord webhook Edge Function
4. Test capture commands
5. Document Discord bot setup

**Dependencies:** Core MCP function  
**Time Estimate:** 1.5 hours  
**Impact:** Additional capture channel

---

## Phase 7: Advanced Extensions (Priority: Low)

### Task 7.1: Professional CRM (Extension #5)
**Objective:** Contact tracking integrated with thoughts.

**Steps:**
1. Copy extension from OB1: `extensions/professional-crm/`
2. Deploy CRM schema with person tracking
3. Add MCP tools for contact management
4. Implement automatic person tagging in thoughts
5. Test meeting prep and follow-up workflows

**Dependencies:** RLS primitive, multiple schemas  
**Time Estimate:** 3-4 hours  
**Impact:** Professional relationship management

---

### Task 7.2: Family Calendar (Extension #3)
**Objective:** Multi-person schedule coordination.

**Steps:**
1. Copy extension from OB1: `extensions/family-calendar/`
2. Deploy calendar schema
3. Add calendar MCP tools
4. Test event creation and queries
5. Integrate with meal planning

**Dependencies:** Home maintenance tracker  
**Time Estimate:** 2-3 hours  
**Impact:** Household coordination hub

---

## Phase 8: Advanced Recipes & Workflows (Priority: Low)

### Task 8.1: Deploy Daily Digest Recipe
**Objective:** Automated daily summary of recent thoughts.

**Steps:**
1. Copy recipe from OB1: `recipes/daily-digest/`
2. Configure email or Slack delivery
3. Set up scheduled Edge Function trigger
4. Customize summary format
5. Test daily delivery

**Dependencies:** Email/Slack integration  
**Time Estimate:** 2 hours  
**Impact:** Daily knowledge review automation

---

### Task 8.2: Entity Extraction Worker
**Objective:** Automatic extraction of people, places, concepts from thoughts.

**Steps:**
1. Copy integration from OB1: `integrations/entity-extraction-worker/`
2. Deploy entity extraction schema
3. Set up worker Edge Function
4. Configure NER model (OpenAI/OpenRouter)
5. Test extraction on existing thoughts

**Dependencies:** Enhanced thoughts schema  
**Time Estimate:** 3 hours  
**Impact:** Automatic knowledge graph building

---

## Success Metrics

**Phase 1 Complete:**
- ✅ Agent memory schema deployed (Task 1.1)
- ⏳ 5+ critical schemas active (Task 1.2 - In Progress)
- ⏳ Fingerprint dedup operational (Task 1.2)

**Phase 2 Complete:**
- ✓ 2 extensions deployed and tested
- ✓ MCP tools working for both
- ✓ Cross-extension queries functional

**Phase 3 Complete:**
- ✓ ChatGPT conversations imported
- ✓ Duplicates identified and cleaned
- ✓ Data quality >95%

**Full System Complete:**
- ✓ All 6 core extensions deployed
- ✓ 10+ schemas active
- ✓ Dashboard operational
- ✓ 2+ capture sources configured
- ✓ MCP clients connected (Claude Desktop, Cursor)
- ✓ 5000+ thoughts with rich metadata

---

## Next Immediate Actions

1. **Deploy Agent Memory Schema** (30 min) - Enables governed agent operations
2. **Deploy Content Fingerprint Dedup** (1 hour) - Critical for data quality
3. **Configure Claude Desktop MCP** (30 min) - Direct integration testing
4. **Build Household Knowledge Extension** (2 hours) - First learning path step

**Estimated Time to Phase 1 Complete:** 4 hours  
**Estimated Time to Phase 2 Complete:** +6 hours (10 hours total)  
**Estimated Time to Full System:** 25-30 hours

---

## References

- [Original OB1 Repository](https://github.com/NateBJones-Projects/OB1)
- [OB1 Getting Started Guide](https://github.com/NateBJones-Projects/OB1/blob/main/docs/01-getting-started.md)
- [OB1 Extensions Learning Path](https://github.com/NateBJones-Projects/OB1#extensions--the-learning-path)
- Local primitives: `primitives/README.md`
- Local schemas: `schemas/README.md`

---

**Last Updated:** 2026-07-13  
**Status:** Phase 1 ready to begin  
**Maintainer:** OB1 Orchestrator (pi)
