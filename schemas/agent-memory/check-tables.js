#!/usr/bin/env node

/**
 * Quick check if agent-memory schema tables exist
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '../../.env');
const envContent = readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [key, ...valueParts] = line.split('=');
      return [key.trim(), valueParts.join('=').trim()];
    })
);

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const EXPECTED_TABLES = [
  'agent_memories',
  'agent_memory_source_refs',
  'agent_memory_artifacts',
  'agent_memory_relations',
  'agent_memory_review_actions',
  'agent_memory_recall_traces',
  'agent_memory_recall_items',
  'agent_memory_audit_events'
];

async function checkTables() {
  console.log('🔍 Checking for agent-memory schema tables...\n');
  
  const results = [];
  
  for (const table of EXPECTED_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      results.push({ table, exists: false });
      console.log(`   ❌ ${table}`);
    } else {
      results.push({ table, exists: true });
      console.log(`   ✓ ${table}`);
    }
  }
  
  const existingCount = results.filter(r => r.exists).length;
  const totalCount = EXPECTED_TABLES.length;
  
  console.log(`\n📊 Summary: ${existingCount}/${totalCount} tables exist\n`);
  
  if (existingCount === 0) {
    console.log('❌ Agent memory schema NOT deployed');
    console.log('   Next step: Deploy the schema');
    return false;
  } else if (existingCount === totalCount) {
    console.log('✅ Agent memory schema FULLY deployed');
    console.log('   You can proceed to validation');
    return true;
  } else {
    console.log('⚠️  Agent memory schema PARTIALLY deployed');
    console.log('   This may indicate an incomplete or failed deployment');
    console.log('   Recommendation: Re-run the deployment');
    return false;
  }
}

checkTables().then(isComplete => {
  process.exit(isComplete ? 0 : 1);
});
