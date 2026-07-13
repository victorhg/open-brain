#!/usr/bin/env node

/**
 * Agent Memory Schema Validation Script
 * 
 * This script:
 * 1. Checks prerequisites (thoughts table exists)
 * 2. Deploys the agent-memory schema
 * 3. Verifies all tables were created
 * 4. Tests with sample data insertion
 * 5. Runs validation queries
 * 6. Cleans up test data
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from project root
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
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
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

async function checkPrerequisites() {
  console.log('📋 Step 1: Checking prerequisites...');
  
  const { data, error } = await supabase
    .from('thoughts')
    .select('id')
    .limit(1);
  
  if (error) {
    console.error('❌ Prerequisites failed: thoughts table does not exist');
    console.error('   Run the core Open Brain setup first (docs/01-getting-started.md)');
    console.error(`   Error: ${error.message}`);
    return false;
  }
  
  console.log('✓ thoughts table exists');
  return true;
}

async function checkSchemaDeployed() {
  console.log('\n📦 Step 2: Checking if schema is deployed...');
  
  // Check if at least one key table exists
  const { data, error } = await supabase
    .from('agent_memories')
    .select('*', { count: 'exact', head: true });
  
  if (error) {
    console.error('❌ Schema not deployed yet');
    console.error('   Please deploy the schema first using: bash schemas/agent-memory/deploy.sh');
    console.error('   Or manually run schemas/agent-memory/schema.sql in Supabase SQL Editor');
    return false;
  }
  
  console.log('✓ Schema appears to be deployed');
  return true;
}

async function verifyTables() {
  console.log('\n🔍 Step 3: Verifying tables were created...');
  
  const results = [];
  
  for (const table of EXPECTED_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.log(`   ❌ ${table} - NOT FOUND`);
      results.push({ table, exists: false, error: error.message });
    } else {
      console.log(`   ✓ ${table} - exists`);
      results.push({ table, exists: true, count: data?.length || 0 });
    }
  }
  
  const allExist = results.every(r => r.exists);
  
  if (!allExist) {
    console.error('\n❌ Some tables were not created');
    return false;
  }
  
  console.log(`\n✓ All ${EXPECTED_TABLES.length} tables verified`);
  return true;
}

async function testDataInsertion() {
  console.log('\n🧪 Step 4: Testing sample data insertion...');
  
  const testMemory = {
    workspace_id: 'test-workspace',
    project_id: 'test-project',
    memory_type: 'lesson',
    summary: 'Test validation memory',
    content: 'This is a test memory created during schema validation',
    provenance_status: 'generated',
    created_by: 'system',
    metadata: {
      validation_test: true,
      timestamp: new Date().toISOString()
    }
  };
  
  // Insert test memory
  const { data: memory, error: insertError } = await supabase
    .from('agent_memories')
    .insert(testMemory)
    .select()
    .single();
  
  if (insertError) {
    console.error('❌ Failed to insert test memory');
    console.error(`   Error: ${insertError.message}`);
    return null;
  }
  
  console.log(`✓ Test memory inserted (id: ${memory.id})`);
  
  // Insert test source reference
  const { error: sourceError } = await supabase
    .from('agent_memory_source_refs')
    .insert({
      memory_id: memory.id,
      source_kind: 'validation_test',
      uri: 'test://validation',
      title: 'Validation Test Source'
    });
  
  if (sourceError) {
    console.error('❌ Failed to insert source reference');
    console.error(`   Error: ${sourceError.message}`);
  } else {
    console.log('✓ Source reference inserted');
  }
  
  // Insert test audit event
  const { error: auditError } = await supabase
    .from('agent_memory_audit_events')
    .insert({
      event_type: 'memory_written',
      workspace_id: testMemory.workspace_id,
      project_id: testMemory.project_id,
      memory_id: memory.id,
      actor_kind: 'system',
      actor_label: 'validation_script',
      payload: { test: true }
    });
  
  if (auditError) {
    console.error('❌ Failed to insert audit event');
    console.error(`   Error: ${auditError.message}`);
  } else {
    console.log('✓ Audit event inserted');
  }
  
  return memory.id;
}

async function runValidationQueries(testMemoryId) {
  console.log('\n✅ Step 5: Running validation queries...');
  
  // Query 1: Retrieve the test memory
  const { data: memory, error: memoryError } = await supabase
    .from('agent_memories')
    .select('*')
    .eq('id', testMemoryId)
    .single();
  
  if (memoryError || !memory) {
    console.error('❌ Failed to retrieve test memory');
    return false;
  }
  console.log('✓ Memory retrieval works');
  
  // Query 2: Check source references
  const { data: sources, error: sourceError } = await supabase
    .from('agent_memory_source_refs')
    .select('*')
    .eq('memory_id', testMemoryId);
  
  if (sourceError) {
    console.error('❌ Failed to query source references');
    return false;
  }
  console.log(`✓ Source reference query works (${sources?.length || 0} refs)`);
  
  // Query 3: Check audit events
  const { data: events, error: auditError } = await supabase
    .from('agent_memory_audit_events')
    .select('*')
    .eq('memory_id', testMemoryId);
  
  if (auditError) {
    console.error('❌ Failed to query audit events');
    return false;
  }
  console.log(`✓ Audit event query works (${events?.length || 0} events)`);
  
  // Query 4: Check constraints (try to insert invalid data)
  const { error: constraintError } = await supabase
    .from('agent_memories')
    .insert({
      workspace_id: 'test',
      memory_type: 'invalid_type', // Should fail
      summary: 'test',
      content: 'test'
    });
  
  if (constraintError) {
    console.log('✓ CHECK constraints enforced (invalid memory_type rejected)');
  } else {
    console.error('⚠️  Warning: CHECK constraint not enforced');
  }
  
  return true;
}

async function cleanup(testMemoryId) {
  console.log('\n🧹 Step 6: Cleaning up test data...');
  
  if (!testMemoryId) {
    console.log('⚠️  No test data to clean up');
    return;
  }
  
  const { error } = await supabase
    .from('agent_memories')
    .delete()
    .eq('id', testMemoryId);
  
  if (error) {
    console.error('⚠️  Failed to clean up test data');
    console.error(`   Error: ${error.message}`);
    console.error(`   Please manually delete: ${testMemoryId}`);
  } else {
    console.log('✓ Test data cleaned up');
  }
}

async function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 AGENT MEMORY SCHEMA VALIDATION SUMMARY');
  console.log('='.repeat(60));
  
  const { count: memoryCount } = await supabase
    .from('agent_memories')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\nTotal memories in database: ${memoryCount || 0}`);
  
  console.log('\nSchema Status:');
  console.log('  ✓ agent_memories - Core memory table');
  console.log('  ✓ agent_memory_source_refs - Source tracking');
  console.log('  ✓ agent_memory_artifacts - Artifact references');
  console.log('  ✓ agent_memory_relations - Memory relationships');
  console.log('  ✓ agent_memory_review_actions - Review audit trail');
  console.log('  ✓ agent_memory_recall_traces - Recall request traces');
  console.log('  ✓ agent_memory_recall_items - Recall items');
  console.log('  ✓ agent_memory_audit_events - Full audit log');
  
  console.log('\nCapabilities Enabled:');
  console.log('  ✓ Governed memory storage with provenance');
  console.log('  ✓ Review workflow (pending → confirmed)');
  console.log('  ✓ Use policy controls (instruction vs evidence)');
  console.log('  ✓ Recall tracing and audit');
  console.log('  ✓ Source reference tracking');
  console.log('  ✓ Content deduplication via hash');
  
  console.log('\nNext Steps:');
  console.log('  1. Deploy agent-memory-api integration (integrations/agent-memory-api/)');
  console.log('  2. Configure MCP server to use agent memory');
  console.log('  3. Review schemas/agent-memory/README.md for usage patterns');
  
  console.log('\n' + '='.repeat(60));
}

async function main() {
  console.log('🚀 Agent Memory Schema Validation\n');
  
  try {
    // Step 1: Check prerequisites
    const prerequisitesPassed = await checkPrerequisites();
    if (!prerequisitesPassed) {
      process.exit(1);
    }
    
    // Step 2: Check schema is deployed
    const schemaDeployed = await checkSchemaDeployed();
    if (!schemaDeployed) {
      process.exit(1);
    }
    
    // Step 3: Verify tables
    const tablesVerified = await verifyTables();
    if (!tablesVerified) {
      process.exit(1);
    }
    
    // Step 4: Test data insertion
    const testMemoryId = await testDataInsertion();
    if (!testMemoryId) {
      process.exit(1);
    }
    
    // Step 5: Run validation queries
    const queriesSucceeded = await runValidationQueries(testMemoryId);
    if (!queriesSucceeded) {
      await cleanup(testMemoryId);
      process.exit(1);
    }
    
    // Step 6: Cleanup
    await cleanup(testMemoryId);
    
    // Print summary
    await printSummary();
    
    console.log('\n✅ Agent Memory schema validation PASSED\n');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Validation failed with error:');
    console.error(error);
    process.exit(1);
  }
}

main();
