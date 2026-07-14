#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from project root
const envPath = join(__dirname, '../.env');
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
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('🔍 Phase 1, Task 1.2: Enhanced Schemas Validation');
  console.log('═'.repeat(60));
  console.log('');
  
  console.log('✓ Connecting to Supabase API...');
  
  // Call the server-side RPC function we defined
  const { data, error } = await supabase.rpc('check_enhanced_schemas');
  
  if (error) {
    if (error.message.includes('does not exist')) {
      console.log('❌ Validation Failed: RPC function check_enhanced_schemas() not found.');
      console.log('   This means the SQL schemas have not been deployed yet.');
      console.log('   Please copy schemas/phase1-task1.2-combined.sql and run it in the');
      console.log('   Supabase Dashboard SQL Editor first.');
    } else {
      console.log(`❌ Connection Error: ${error.message}`);
    }
    process.exit(1);
  }

  let totalPassed = 0;
  let totalFailed = 0;

  console.log('\n📦 Checking Tables...');
  for (const [table, exists] of Object.entries(data.tables)) {
    if (exists) {
      console.log(`  ✅ Table '${table}' exists`);
      totalPassed++;
    } else {
      console.log(`  ❌ Table '${table}' is missing`);
      totalFailed++;
    }
  }

  console.log('\n🏷️  Checking Columns on thoughts table...');
  for (const [column, exists] of Object.entries(data.columns)) {
    if (exists) {
      console.log(`  ✅ Column '${column}' exists`);
      totalPassed++;
    } else {
      console.log(`  ❌ Column '${column}' is missing`);
      totalFailed++;
    }
  }

  console.log('\n⚙️  Checking RPC Functions...');
  for (const [func, exists] of Object.entries(data.functions)) {
    if (exists) {
      console.log(`  ✅ Function '${func}' is active`);
      totalPassed++;
    } else {
      console.log(`  ❌ Function '${func}' is missing`);
      totalFailed++;
    }
  }

  console.log('\n🧩 Checking Database Extensions...');
  for (const [ext, exists] of Object.entries(data.extensions)) {
    if (exists) {
      console.log(`  ✅ Extension '${ext}' is enabled`);
      totalPassed++;
    } else {
      console.log(`  ❌ Extension '${ext}' is disabled`);
      totalFailed++;
    }
  }

  console.log('\n⚡ Checking Database Indexes...');
  for (const [idx, exists] of Object.entries(data.indexes)) {
    if (exists) {
      console.log(`  ✅ Index '${idx}' is active`);
      totalPassed++;
    } else {
      console.log(`  ❌ Index '${idx}' is missing`);
      totalFailed++;
    }
  }

  // Double check and backfill stats
  console.log('\n📊 Checking data backfill status...');
  const { count: totalCount, error: countErr } = await supabase
    .from('thoughts')
    .select('*', { count: 'exact', head: true });
    
  if (countErr) {
    console.log(`  ❌ Error counting thoughts: ${countErr.message}`);
  } else {
    const { count: primaryCount, error: primErr } = await supabase
      .from('thoughts')
      .select('*', { count: 'exact', head: true })
      .eq('derivation_layer', 'primary');
      
    if (primErr) {
      console.log(`  ❌ Error querying derivation layer: ${primErr.message}`);
    } else {
      console.log(`  ✅ ${primaryCount}/${totalCount} thoughts marked as 'primary' derivation layer`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`📊 Results: ${totalPassed} checks passed, ${totalFailed} checks failed.`);
  console.log('═'.repeat(60));
  console.log('');

  if (totalFailed === 0) {
    console.log('🎉 SUCCESS: All 5 enhanced schemas are fully deployed and operational!');
    console.log('   Your Open Brain instance now supports:');
    console.log('     - Content fingerprinting & smart ingestion');
    console.log('     - Trigram-accelerated text searches');
    console.log('     - Structured metadata classification (importance, quality, etc.)');
    console.log('     - Workflow status/kanban boards');
    console.log('     - Deep provenance derivation chains');
    console.log('');
    process.exit(0);
  } else {
    console.log('⚠️  FAILED: Some schema components are missing.');
    console.log('   Please review the errors above and ensure you have run the full content');
    console.log('   of schemas/phase1-task1.2-combined.sql in the Supabase Dashboard.');
    console.log('');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error running validation:', err);
  process.exit(1);
});
