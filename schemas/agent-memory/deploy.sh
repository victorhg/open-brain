#!/bin/bash

# Agent Memory Schema Deployment and Validation
# This script deploys the agent-memory schema and validates it

set -e

echo "🚀 Agent Memory Schema Deployment"
echo "=================================="
echo ""

# Check if we have the schema file
if [ ! -f "schemas/agent-memory/schema.sql" ]; then
  echo "❌ Error: schema.sql not found"
  echo "   Expected: schemas/agent-memory/schema.sql"
  exit 1
fi

echo "📋 Step 1: Deploying schema to Supabase"
echo ""
echo "Please complete these steps in your Supabase Dashboard:"
echo ""
echo "  1. Open: https://supabase.com/dashboard"
echo "  2. Select your 'open-brain' project"
echo "  3. Go to: SQL Editor → New Query"
echo "  4. Copy the contents of: schemas/agent-memory/schema.sql"
echo "  5. Paste into the SQL Editor"
echo "  6. Click 'Run' (or press Cmd/Ctrl + Enter)"
echo ""
echo "The schema creates 8 tables for governed agent memory:"
echo "  - agent_memories (core memory table)"
echo "  - agent_memory_source_refs (source tracking)"
echo "  - agent_memory_artifacts (artifact references)"
echo "  - agent_memory_relations (memory relationships)"
echo "  - agent_memory_review_actions (review audit trail)"
echo "  - agent_memory_recall_traces (recall request traces)"
echo "  - agent_memory_recall_items (recall items)"
echo "  - agent_memory_audit_events (full audit log)"
echo ""
read -p "Press Enter after running the SQL in Supabase Dashboard..."

echo ""
echo "🔍 Step 2: Validating deployment"
echo ""

# Source .env file
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
else
  echo "❌ Error: .env file not found"
  exit 1
fi

# Check for required environment variables
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: Missing required environment variables"
  echo "   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env"
  exit 1
fi

# Install validation script dependencies if needed
if [ ! -d "schemas/agent-memory/node_modules" ]; then
  echo "📦 Installing validation dependencies..."
  cd schemas/agent-memory
  npm install @supabase/supabase-js
  cd ../..
fi

# Run validation
echo "Running validation script..."
node schemas/agent-memory/validate.js

echo ""
echo "✅ Deployment complete!"
