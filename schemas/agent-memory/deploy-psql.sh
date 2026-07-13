#!/bin/bash

# Agent Memory Schema Deployment using psql
set -e

echo "🚀 Agent Memory Schema Deployment"
echo "=================================="
echo ""

# Load environment variables
if [ -f .env ]; then
  set -a
  source .env
  set +a
else
  echo "❌ Error: .env file not found"
  exit 1
fi

# Check for required variables
if [ -z "$SUPABASE_URL" ]; then
  echo "❌ Error: SUPABASE_URL not set in .env"
  exit 1
fi

# Extract project reference from SUPABASE_URL
# Format: https://PROJECT_REF.supabase.co
PROJECT_REF=$(echo "$SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|')

if [ -z "$PROJECT_REF" ]; then
  echo "❌ Error: Could not extract project reference from SUPABASE_URL"
  exit 1
fi

echo "📋 Project: $PROJECT_REF"
echo ""

# Check if we have the database password
if [ -z "$SUPABASE_DB_PASSWORD" ]; then
  echo "⚠️  SUPABASE_DB_PASSWORD not found in .env"
  echo ""
  echo "Please provide your Supabase database password"
  echo "(This is the password you set when creating the project)"
  echo ""
  read -sp "Database Password: " DB_PASSWORD
  echo ""
else
  DB_PASSWORD="$SUPABASE_DB_PASSWORD"
fi

# Construct connection string
DB_URL="postgresql://postgres:${DB_PASSWORD}@${PROJECT_REF}.supabase.co:5432/postgres"

echo "📦 Deploying schema..."
echo ""

# Run the schema SQL
if PGPASSWORD="$DB_PASSWORD" psql "$DB_URL" -f schemas/agent-memory/schema.sql; then
  echo ""
  echo "✅ Schema deployed successfully!"
  echo ""
else
  echo ""
  echo "❌ Schema deployment failed"
  echo ""
  echo "If you see an authentication error, please verify:"
  echo "  1. Your database password is correct"
  echo "  2. Your IP is allowed (check Supabase Dashboard → Settings → Database)"
  echo ""
  exit 1
fi

echo "🔍 Running validation..."
echo ""

# Install dependencies if needed
if [ ! -d "schemas/agent-memory/node_modules" ]; then
  echo "📦 Installing validation dependencies..."
  cd schemas/agent-memory
  npm install --silent
  cd ../..
  echo ""
fi

# Run validation
node schemas/agent-memory/validate.js

echo ""
echo "✅ Phase 1, Task 1 complete!"
echo ""
echo "Next steps:"
echo "  - Update TASKS.md to mark Task 1.1 as complete"
echo "  - Proceed to Task 1.2: Deploy Enhanced Schemas"
